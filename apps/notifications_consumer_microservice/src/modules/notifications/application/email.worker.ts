import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { EmailJob } from '@repo/shared';
import {
  CONSUMER_REGISTRY,
  type DeliveryContext,
  type EmailJobHandler,
  type IConsumerRegistry,
} from '../../../common/messaging/consumer.types';
import { EmailDelivery } from '../domain/entities/email-delivery.entity';
import {
  EMAIL_DELIVERY_REPOSITORY,
  type IEmailDeliveryRepository,
} from '../domain/interfaces/email-delivery-repository.port';
import { MAILER, type IMailer } from '../domain/interfaces/mailer.port';
import {
  RECIPIENT_DIRECTORY,
  type IRecipientDirectory,
} from '../domain/interfaces/recipient-directory.port';
import { renderEmail } from '../infrastructure/mail/email-templates';

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sole consumer of `notifications.email` (FR-036, FR-039). The
 * `email_deliveries` row is the idempotency key: a SENT or FAILED row is
 * acked without sending. A failure is recorded on the row and rethrown, so
 * the job goes to `notifications.email.retry`; the third failure (by the
 * row's `attempts`, or the queue's final attempt, whichever comes first)
 * closes the row as FAILED, logs an error and acks.
 */
@Injectable()
export class EmailWorker implements EmailJobHandler, OnModuleInit {
  private readonly logger = new Logger(EmailWorker.name);

  constructor(
    @Inject(CONSUMER_REGISTRY) private readonly registry: IConsumerRegistry,
    @Inject(EMAIL_DELIVERY_REPOSITORY)
    private readonly deliveries: IEmailDeliveryRepository,
    @Inject(RECIPIENT_DIRECTORY)
    private readonly directory: IRecipientDirectory,
    @Inject(MAILER) private readonly mailer: IMailer,
  ) {}

  onModuleInit(): void {
    this.registry.registerEmailHandler(this);
  }

  async handle(job: EmailJob, ctx: DeliveryContext): Promise<void> {
    const delivery = await this.loadOrInsert(job);
    if (!delivery.isPending()) {
      this.logger.debug(
        `Email job ${job.jobId} already ${delivery.status}; skipping`,
      );
      return;
    }

    let to: string | null;
    try {
      to = await this.directory.getEmail(job.recipientId);
    } catch (error) {
      return this.recordAttemptFailure(delivery, error, ctx);
    }
    if (to === null) {
      // Retrying cannot produce an address: close the delivery now.
      return this.fail(delivery, new Error('Recipient has no email address'));
    }

    try {
      await this.mailer.send({ to, ...renderEmail(job) });
    } catch (error) {
      return this.recordAttemptFailure(delivery, error, ctx);
    }

    delivery.markSent(new Date());
    try {
      await this.deliveries.save(delivery);
    } catch (error) {
      // The email is out; a retry would send it twice. Ack and log.
      this.logger.warn(
        `Email job ${job.jobId} sent but not marked SENT: ${reasonOf(error)}`,
      );
    }
  }

  /** The handler threw on the last attempt (e.g. the row could not be saved). */
  async onExhausted(job: EmailJob, error: unknown): Promise<void> {
    try {
      const delivery = await this.loadOrInsert(job);
      if (delivery.isPending()) {
        await this.fail(delivery, error);
        return;
      }
    } catch (saveError) {
      this.logger.warn(
        `Email job ${job.jobId}: could not record FAILED: ${reasonOf(saveError)}`,
      );
    }
    this.logger.error(
      `Email job ${job.jobId} dropped after its last attempt: ${reasonOf(error)}`,
    );
  }

  private async loadOrInsert(job: EmailJob): Promise<EmailDelivery> {
    const existing = await this.deliveries.findByJobId(job.jobId);
    if (existing) return existing;
    return this.deliveries.save(
      EmailDelivery.pending(job.jobId, job.recipientId, job.kind),
    );
  }

  /** Records the attempt; throws to retry unless the delivery is now closed. */
  private async recordAttemptFailure(
    delivery: EmailDelivery,
    error: unknown,
    ctx: DeliveryContext,
  ): Promise<void> {
    if (ctx.isFinalAttempt) {
      return this.fail(delivery, error);
    }
    delivery.recordFailure(error);
    await this.deliveries.save(delivery);
    if (!delivery.isPending()) {
      this.logFailed(delivery);
      return;
    }
    this.logger.warn(
      `Email job ${delivery.jobId} attempt ${delivery.attempts} failed: ${reasonOf(error)}`,
    );
    throw error;
  }

  /** Closes the delivery as FAILED (attempts = MAX), logs at error, acks. */
  private async fail(delivery: EmailDelivery, error: unknown): Promise<void> {
    delivery.markFailed(error);
    await this.deliveries.save(delivery);
    this.logFailed(delivery);
  }

  private logFailed(delivery: EmailDelivery): void {
    this.logger.error(
      `Email job ${delivery.jobId} FAILED after ${delivery.attempts} attempts: ${delivery.lastError}`,
    );
  }
}
