import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssetsTable1785846414747 implements MigrationInterface {
  name = 'AddAssetsTable1785846414747';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_comments_parentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_105079775692df1f8799ed0fac"`,
    );
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "type"`);
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "uploaderId" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "follows" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "mimeType" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "size" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a11d56f59f1c840afe1510f9fa" ON "assets"  ("uploaderId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "follows" ADD CONSTRAINT "UQ_105079775692df1f8799ed0fac8" UNIQUE ("followerId", "followingId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_8770bd9030a3d13c5f79a7d2e81" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_4548cc4a409b8651ec75f70e280" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ADD CONSTRAINT "FK_c5a322ad12a7bf95460c958e80e" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "posts" DROP CONSTRAINT "FK_c5a322ad12a7bf95460c958e80e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_4548cc4a409b8651ec75f70e280"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_8770bd9030a3d13c5f79a7d2e81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "follows" DROP CONSTRAINT "UQ_105079775692df1f8799ed0fac8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a11d56f59f1c840afe1510f9fa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "size" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ALTER COLUMN "mimeType" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "follows" DROP COLUMN "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "uploaderId"`);
    await queryRunner.query(
      `ALTER TABLE "assets" ADD "type" character varying(50) NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_105079775692df1f8799ed0fac" ON "follows" USING btree ("followerId", "followingId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_comments_parentId" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
