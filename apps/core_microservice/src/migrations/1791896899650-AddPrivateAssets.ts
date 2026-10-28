import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Private (presigned-URL) attachments (specs/003-realtime-chat/data-model.md):
 * `assets.url` becomes nullable and the table gains `visibility`, `bucket`,
 * `storageKey` and `originalName`. Existing rows stay `PUBLIC`.
 */
export class AddPrivateAssets1791896899650 implements MigrationInterface {
  name = 'AddPrivateAssets1791896899650';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "url" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "visibility" character varying(10) NOT NULL DEFAULT 'PUBLIC'`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "bucket" character varying(63)`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "storageKey" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "originalName" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "originalName"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "storageKey"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "bucket"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "visibility"`);
    // Private rows have no url; they can't survive the NOT NULL restore.
    await queryRunner.query(`DELETE FROM "assets" WHERE "url" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "url" SET NOT NULL`,
    );
  }
}
