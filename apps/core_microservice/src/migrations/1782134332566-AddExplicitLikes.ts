import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExplicitLikes1782134332566 implements MigrationInterface {
  name = 'AddExplicitLikes1782134332566';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "comment_likes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "commentId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_2c299aaf1f903c45ee7e6c7b419" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34d1f902a8a527dbc2502f87c8" ON "comment_likes"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ec6698ead14ad945033ebb2f1b" ON "comment_likes"  ("commentId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "post_likes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_e4ac7cb9daf243939c6eabb2e0d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_37d337ad54b1aa6b9a44415a49" ON "post_likes"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_30ee85070afe5b92b5920957b1" ON "post_likes"  ("postId", "userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_likes" ADD CONSTRAINT "FK_abbd506a94a424dd6a3a68d26f4" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_likes" ADD CONSTRAINT "FK_6999d13aca25e33515210abaf16" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post_likes" DROP CONSTRAINT "FK_6999d13aca25e33515210abaf16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_likes" DROP CONSTRAINT "FK_abbd506a94a424dd6a3a68d26f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30ee85070afe5b92b5920957b1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_37d337ad54b1aa6b9a44415a49"`,
    );
    await queryRunner.query(`DROP TABLE "post_likes"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ec6698ead14ad945033ebb2f1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34d1f902a8a527dbc2502f87c8"`,
    );
    await queryRunner.query(`DROP TABLE "comment_likes"`);
  }
}
