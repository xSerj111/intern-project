import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReposts1786100000000 implements MigrationInterface {
  name = 'AddReposts1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reposts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "originalPostId" uuid NOT NULL, "authorId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_reposts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reposts_authorId" ON "reposts" ("authorId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_reposts_originalPostId_authorId" ON "reposts" ("originalPostId", "authorId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reposts" ADD CONSTRAINT "FK_reposts_originalPostId" FOREIGN KEY ("originalPostId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reposts" DROP CONSTRAINT "FK_reposts_originalPostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reposts_originalPostId_authorId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_reposts_authorId"`);
    await queryRunner.query(`DROP TABLE "reposts"`);
  }
}
