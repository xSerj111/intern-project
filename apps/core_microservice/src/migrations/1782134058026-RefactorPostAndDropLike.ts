import { MigrationInterface, QueryRunner } from "typeorm";

export class RefactorPostAndDropLike1782134058026 implements MigrationInterface {
    name = 'RefactorPostAndDropLike1782134058026'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "mediaUrls"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "posts" ADD "mediaUrls" text array NOT NULL DEFAULT '{}'`);
    }

}
