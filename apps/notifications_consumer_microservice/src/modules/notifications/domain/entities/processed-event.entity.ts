import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Processed events older than this are purged. */
export const PROCESSED_EVENT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Idempotency marker, inserted in the same transaction as the event's
 * effects. `followUpDone` flips once the post-commit steps (publish
 * `notification.created`, enqueue the email job) have succeeded.
 */
@Entity('processed_events')
@Index('IDX_processed_events_processedAt', ['processedAt'])
export class ProcessedEvent {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_processed_events_eventId',
  })
  eventId!: string;

  @Column({ type: 'varchar', length: 100 })
  routingKey!: string;

  @Column({ type: 'boolean', default: false })
  followUpDone!: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  processedAt!: Date;

  static record(
    eventId: string,
    routingKey: string,
    now: Date,
  ): ProcessedEvent {
    const event = new ProcessedEvent();
    event.eventId = eventId;
    event.routingKey = routingKey;
    event.followUpDone = false;
    event.processedAt = now;
    return event;
  }

  markFollowUpDone(): void {
    this.followUpDone = true;
  }

  /** Rows processed before this instant are purgeable. */
  static retentionCutoff(now: Date): Date {
    return new Date(now.getTime() - PROCESSED_EVENT_RETENTION_DAYS * DAY_MS);
  }

  isExpired(now: Date): boolean {
    return this.processedAt < ProcessedEvent.retentionCutoff(now);
  }
}
