import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Upload lifecycle columns on `assets` (data-model §1).
 *
 * Existing rows default to `READY`; legacy chat uploads backfill their
 * `purpose`. The partial index predicate mirrors the sweeper query exactly
 * (`status = 'PENDING' AND "expiresAt" < ...`) so the planner can use it.
 */
export class AddUploadLifecycleToAssets1792460000000 implements MigrationInterface {
  name = 'AddUploadLifecycleToAssets1792460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "status" character varying(16) NOT NULL DEFAULT 'READY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "purpose" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "assets" SET "purpose" = 'chat-attachment' WHERE "storageKey" LIKE 'chat/%'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_assets_pending_expiry" ON "assets" ("expiresAt") WHERE status = 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_assets_pending_expiry"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "expiresAt"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "purpose"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "status"`);
  }
}
