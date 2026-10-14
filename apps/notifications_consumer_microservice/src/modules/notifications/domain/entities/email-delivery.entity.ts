import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { NotificationKind } from '@repo/shared';
import { EmailDeliveryFinalizedError } from '../errors/notification.errors';

export const MAX_EMAIL_ATTEMPTS = 3;

export type EmailDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

/** Delivery log for one email job. `PENDING -> SENT | FAILED` (both terminal). */
@Entity('email_deliveries')
export class EmailDelivery {
  /** `{eventId}:{recipientId}` */
  @PrimaryColumn({
    type: 'varchar',
    length: 80,
    primaryKeyConstraintName: 'PK_email_deliveries_jobId',
  })
  jobId!: string;

  @Column({ type: 'uuid' })
  recipientId!: string;

  /** Notification kind, or `NEW_MESSAGE`. */
  @Column({ type: 'varchar', length: 30 })
  kind!: NotificationKind | 'NEW_MESSAGE';

  @Column({ type: 'varchar', length: 10 })
  status!: EmailDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  static pending(
    jobId: string,
    recipientId: string,
    kind: NotificationKind | 'NEW_MESSAGE',
  ): EmailDelivery {
    const delivery = new EmailDelivery();
    delivery.jobId = jobId;
    delivery.recipientId = recipientId;
    delivery.kind = kind;
    delivery.status = 'PENDING';
    delivery.attempts = 0;
    delivery.lastError = null;
    delivery.sentAt = null;
    return delivery;
  }

  isPending(): boolean {
    return this.status === 'PENDING';
  }

  isSent(): boolean {
    return this.status === 'SENT';
  }

  /** Counts a successful attempt and closes the delivery. */
  markSent(now: Date): void {
    this.assertPending();
    this.attempts += 1;
    this.status = 'SENT';
    this.sentAt = now;
    this.lastError = null;
  }

  /**
   * Counts a failed attempt. After {@link MAX_EMAIL_ATTEMPTS} the delivery
   * becomes `FAILED`; until then it stays `PENDING` so the job can be retried.
   */
  recordFailure(error: unknown): void {
    this.assertPending();
    this.attempts += 1;
    this.lastError = error instanceof Error ? error.message : String(error);
    if (this.attempts >= MAX_EMAIL_ATTEMPTS) {
      this.status = 'FAILED';
    }
  }

  private assertPending(): void {
    if (!this.isPending()) {
      throw new EmailDeliveryFinalizedError(this.jobId, this.status);
    }
  }
}
