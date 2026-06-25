import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostStatus1782200000000 implements MigrationInterface {
  name = 'AddPostStatus1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."posts_status_enum" AS ENUM('draft', 'published')`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ADD "status" "public"."posts_status_enum" NOT NULL DEFAULT 'draft'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum"`);
  }
}
