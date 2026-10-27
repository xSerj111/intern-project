import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Counter, Gauge } from 'prom-client';
import type { Registry } from 'prom-client';
import type { EventEnvelope } from '@repo/shared';
import { AppConfigService } from '../../config/app-config.service';
import { METRICS_REGISTRY } from '../observability/metrics.tokens';
import { EVENT_BUS, EventRejectedError } from './event-bus.port';
import type { EventBusPort } from './event-bus.port';
import type { OutboxEvent } from './outbox-event.entity';
import { OUTBOX_PORT } from './outbox.port';
import type { IOutboxPort } from './outbox.port';

export const OUTBOX_POLL_INTERVAL_MS = 500;
export const OUTBOX_BATCH_SIZE = 100;
/** First retry delay after a failed drain; doubles per consecutive failure. */
export const OUTBOX_BACKOFF_BASE_MS = 1_000;
export const OUTBOX_BACKOFF_MAX_MS = 30_000;
export const OUTBOX_PURGE_INTERVAL_MS = 60 * 60 * 1000;
export const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_ERROR_MAX_LENGTH = 1_000;

/**
 * Publishes pending outbox rows to the broker (at-least-once). Runs on a 500 ms
 * poll plus the outbox's post-commit wake signal; wakes during a drain are
 * coalesced into one re-drain. A failed publish leaves the row pending, ends
 * the drain (so the row is retried first, keeping order) and backs off. After
 * `OUTBOX_MAX_ATTEMPTS` failed attempts the row is dead-lettered instead: it is
 * marked dead, logged at error level and skipped, and the drain moves on.
 * Only row-attributable failures (`EventRejectedError`) count toward that
 * limit. Broker-side failures (broker down, nack, confirm timeout, closed
 * channel) only record `lastError` and back off, so an outage of any length
 * never dead-letters healthy rows.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private pollTimer?: NodeJS.Timeout;
  private purgeTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private inFlight: Promise<void> | null = null;
  private redrainRequested = false;
  private stopped = false;
  private consecutiveFailures = 0;
  private retryAt = 0;
  private refreshingStats = false;
  private readonly maxAttempts: number;
  private readonly publishedTotal: Counter;
  private readonly failedTotal: Counter;
  private readonly deadTotal: Counter;
  private readonly pendingGauge: Gauge;
  private readonly oldestPendingGauge: Gauge;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(OUTBOX_PORT) private readonly outbox: IOutboxPort,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
    config: AppConfigService,
    @Inject(METRICS_REGISTRY) registry: Registry,
  ) {
    this.maxAttempts = config.outbox.maxAttempts;
    this.publishedTotal = getOrCreate(
      registry,
      'outbox_published_total',
      () =>
        new Counter({
          name: 'outbox_published_total',
          help: 'Outbox events confirmed by the broker',
          registers: [registry],
        }),
    );
    this.failedTotal = getOrCreate(
      registry,
      'outbox_failed_total',
      () =>
        new Counter({
          name: 'outbox_failed_total',
          help: 'Outbox publish attempts that failed (including dead-lettered)',
          registers: [registry],
        }),
    );
    this.deadTotal = getOrCreate(
      registry,
      'outbox_dead_total',
      () =>
        new Counter({
          name: 'outbox_dead_total',
          help: 'Outbox events dead-lettered after reaching the max attempts',
          registers: [registry],
        }),
    );
    this.pendingGauge = getOrCreate(
      registry,
      'outbox_pending',
      () =>
        new Gauge({
          name: 'outbox_pending',
          help: 'Outbox events neither published nor dead-lettered',
          registers: [registry],
        }),
    );
    this.oldestPendingGauge = getOrCreate(
      registry,
      'outbox_oldest_pending_seconds',
      () =>
        new Gauge({
          name: 'outbox_oldest_pending_seconds',
          help: 'Age of the oldest pending outbox event (0 when none)',
          registers: [registry],
        }),
    );
  }

  onModuleInit(): void {
    this.stopped = false;
    this.unsubscribe = this.outbox.onPending(() => this.trigger());
    this.pollTimer = setInterval(() => {
      void this.refreshStats();
      this.trigger();
    }, OUTBOX_POLL_INTERVAL_MS);
    this.pollTimer.unref();
    this.purgeTimer = setInterval(
      () => void this.purge(),
      OUTBOX_PURGE_INTERVAL_MS,
    );
    this.purgeTimer.unref();
    this.logger.log('Outbox relay started');
    this.trigger();
  }

  /**
   * Called before the global MessagingModule closes the AMQP connection (see
   * messaging.module.ts), so the in-flight publish can still be confirmed.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.purgeTimer);
    this.pollTimer = this.purgeTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.inFlight;
  }

  /** Drains now (or joins the running drain, asking it to go once more). */
  drain(): Promise<void> {
    if (this.inFlight) {
      this.redrainRequested = true;
      return this.inFlight;
    }
    this.inFlight = this.drainLoop().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** One aggregate query per poll; gauges keep their last value on error. */
  private async refreshStats(): Promise<void> {
    if (this.refreshingStats || this.stopped) return;
    this.refreshingStats = true;
    try {
      const stats = await this.outbox.pendingStats();
      this.pendingGauge.set(stats.count);
      this.oldestPendingGauge.set(stats.count > 0 ? stats.oldestSeconds : 0);
    } catch (err) {
      this.logger.warn(`Outbox stats refresh failed: ${errorMessage(err)}`);
    } finally {
      this.refreshingStats = false;
    }
  }

  private trigger(): void {
    if (this.stopped || Date.now() < this.retryAt) return;
    void this.drain();
  }

  private async drainLoop(): Promise<void> {
    do {
      this.redrainRequested = false;
      let claimed: number;
      try {
        claimed = await this.drainBatch();
      } catch (err) {
        this.backOff(`Outbox drain failed: ${errorMessage(err)}`);
        return;
      }
      if (claimed < 0) return; // a publish failed; backOff already armed
      this.consecutiveFailures = 0;
      this.retryAt = 0;
      if (claimed === OUTBOX_BATCH_SIZE) this.redrainRequested = true;
    } while (this.redrainRequested && !this.stopped);
  }

  /**
   * Claims one batch and publishes it row by row inside the claiming
   * transaction (the row locks hold until it commits). Returns the number of
   * rows claimed, or -1 when a publish failed.
   */
  private drainBatch(): Promise<number> {
    return this.dataSource.transaction(async (tx) => {
      const rows = await this.outbox.claimPending(OUTBOX_BATCH_SIZE, tx);
      for (const row of rows) {
        if (this.stopped) break;
        try {
          await this.eventBus.publish(toEnvelope(row), {
            correlationId: row.correlationId ?? undefined,
          });
        } catch (err) {
          const message = errorMessage(err).slice(0, LAST_ERROR_MAX_LENGTH);
          this.failedTotal.inc();
          if (!(err instanceof EventRejectedError)) {
            // Broker-side: transient, never counts toward dead-lettering.
            await this.outbox.recordError(row.id, message, tx);
          } else if (row.attempts + 1 >= this.maxAttempts) {
            await this.outbox.markDead(row.id, message, tx);
            this.deadTotal.inc();
            this.logger.error(
              `Outbox event ${row.routingKey} ${row.id} dead-lettered after ${row.attempts + 1} failed attempts: ${message}`,
            );
            continue; // skip the poison row; healthy rows behind it go on
          } else {
            await this.outbox.markFailed(row.id, message, tx);
          }
          this.backOff(
            `Outbox publish of ${row.routingKey} ${row.id} failed: ${message}`,
          );
          return -1;
        }
        await this.outbox.markPublished(row.id, tx);
        this.publishedTotal.inc();
      }
      return rows.length;
    });
  }

  private backOff(reason: string): void {
    this.consecutiveFailures += 1;
    const delay = Math.min(
      OUTBOX_BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1),
      OUTBOX_BACKOFF_MAX_MS,
    );
    this.retryAt = Date.now() + delay;
    this.logger.warn(`${reason}; retrying in ${delay} ms`);
  }

  private async purge(): Promise<void> {
    try {
      const purged = await this.outbox.purgePublished(
        new Date(Date.now() - OUTBOX_RETENTION_MS),
      );
      if (purged > 0) {
        this.logger.log(`Purged ${purged} published outbox events`);
      }
    } catch (err) {
      this.logger.warn(`Outbox purge failed: ${errorMessage(err)}`);
    }
  }
}

function getOrCreate<M extends Counter | Gauge>(
  registry: Registry,
  name: string,
  create: () => M,
): M {
  return (registry.getSingleMetric(name) as M | undefined) ?? create();
}

function toEnvelope(row: OutboxEvent): EventEnvelope<object> {
  return {
    eventId: row.id,
    type: row.routingKey,
    version: 1,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
