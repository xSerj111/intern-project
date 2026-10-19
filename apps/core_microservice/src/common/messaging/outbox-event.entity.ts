import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Transactional outbox row (specs/003-realtime-chat/data-model.md). Written in
 * the same transaction as the business action, then published to the broker by
 * the relay. `id` doubles as the envelope `eventId` (consumer idempotency key).
 */
@Entity('outbox_events')
@Index('IDX_outbox_events_pending', ['occurredAt'], {
  where: '"publishedAt" IS NULL AND "deadLetteredAt" IS NULL',
})
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_outbox_events',
  })
  id!: string;

  /** Also the envelope `type`, e.g. `social.post.liked`. */
  @Column({ type: 'varchar', length: 100 })
  routingKey!: string;

  @Column({ type: 'jsonb' })
  payload!: object;

  /** When the business action committed. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt!: Date;

  /** null and not dead-lettered = pending. */
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  /**
   * Set when the relay gave up after the configured number of failed publish
   * attempts. Dead rows are skipped (and never purged); `lastError` says why.
   * Re-queue by hand with `SET "deadLetteredAt" = NULL, "attempts" = 0`.
   */
  @Column({ type: 'timestamptz', nullable: true })
  deadLetteredAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;
}
