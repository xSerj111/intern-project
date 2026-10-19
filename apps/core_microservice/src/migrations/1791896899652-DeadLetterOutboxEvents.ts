import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbox dead-lettering: the relay marks a row dead after too many failed
 * publish attempts so it stops blocking the queue. "Pending" now means not
 * published AND not dead, so the partial index predicate changes with it.
 */
export class DeadLetterOutboxEvents1791896899652 implements MigrationInterface {
  name = 'DeadLetterOutboxEvents1791896899652';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ADD "deadLetteredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_outbox_events_pending"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_pending" ON "outbox_events" ("occurredAt") WHERE "publishedAt" IS NULL AND "deadLetteredAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_outbox_events_pending"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_pending" ON "outbox_events" ("occurredAt") WHERE "publishedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" DROP COLUMN "deadLetteredAt"`,
    );
  }
}
