import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The notifications list pages on `(occurredAt, id)` (keyset with a
 * tie-breaker), so the index gains `id DESC` to serve
 * `ORDER BY "occurredAt" DESC, id DESC` and the row-value cursor.
 */
export class NotificationsKeysetIndex1792600000000 implements MigrationInterface {
  name = 'NotificationsKeysetIndex1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipientId_occurredAt_id" ON "notifications" ("recipientId", "occurredAt" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notifications_recipientId_occurredAt"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipientId_occurredAt" ON "notifications" ("recipientId", "occurredAt" DESC)`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notifications_recipientId_occurredAt_id"`,
    );
  }
}
