import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Transactional outbox row (specs/003-realtime-chat/data-model.md). Written in
 * the same transaction as the business action, then published to the broker by
 * the relay. `id` doubles as the envelope `eventId` (consumer idempotency key).
 */
@Entity('outbox_events')
@Index('IDX_outbox_events_pending', ['occurredAt'], {
  where: '"publishedAt" IS NULL',
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

  /** null = pending. */
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;
}
