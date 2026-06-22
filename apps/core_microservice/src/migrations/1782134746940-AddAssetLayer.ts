import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAssetLayer1782134746940 implements MigrationInterface {
    name = 'AddAssetLayer1782134746940'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "url" character varying NOT NULL, "type" character varying(50) NOT NULL, "mimeType" character varying(100), "size" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "post_assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "assetId" uuid NOT NULL, "displayOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ed08ca38aaa5e342de73e419b33" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_34ce254c33604b0560844ceab9" ON "post_assets"  ("postId", "assetId") `);
        await queryRunner.query(`ALTER TABLE "post_assets" ADD CONSTRAINT "FK_6398640d8ed9d913f630463fba9" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_assets" ADD CONSTRAINT "FK_fc27f8f6edf7bde8b31d788ff70" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "post_assets" DROP CONSTRAINT "FK_fc27f8f6edf7bde8b31d788ff70"`);
        await queryRunner.query(`ALTER TABLE "post_assets" DROP CONSTRAINT "FK_6398640d8ed9d913f630463fba9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_34ce254c33604b0560844ceab9"`);
        await queryRunner.query(`DROP TABLE "post_assets"`);
        await queryRunner.query(`DROP TABLE "assets"`);
    }

}
