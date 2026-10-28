import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transactional outbox table (specs/003-realtime-chat/data-model.md): events are
 * written in the same transaction as the business action and published to the
 * broker by the relay. `id` is also the envelope `eventId`.
 */
export class AddOutboxEvents1791896899651 implements MigrationInterface {
  name = 'AddOutboxEvents1791896899651';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "routingKey" character varying(100) NOT NULL, "payload" jsonb NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "publishedAt" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "lastError" text, CONSTRAINT "PK_outbox_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_pending" ON "outbox_events" ("occurredAt") WHERE "publishedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_outbox_events_pending"`);
    await queryRunner.query(`DROP TABLE "outbox_events"`);
  }
}
