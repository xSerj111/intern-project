import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPostArchivedStatus1785851415891 implements MigrationInterface {
    name = 'AddPostArchivedStatus1785851415891'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."posts_status_enum" ADD VALUE 'archived'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."posts_status_enum_old" AS ENUM('draft', 'published')`);
        await queryRunner.query(`ALTER TABLE "posts" ALTER COLUMN "status" TYPE "public"."posts_status_enum_old" USING "status"::"text"::"public"."posts_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."posts_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."posts_status_enum_old" RENAME TO "posts_status_enum"`);
    }

}
