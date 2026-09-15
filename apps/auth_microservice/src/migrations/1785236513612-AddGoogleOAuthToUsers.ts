import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGoogleOAuthToUsers1785236513612 implements MigrationInterface {
    name = 'AddGoogleOAuthToUsers1785236513612'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "auth_users" ADD "googleId" character varying`);
        await queryRunner.query(`ALTER TABLE "auth_users" ADD CONSTRAINT "UQ_2912c716163af3aaa0cbe4eb8e1" UNIQUE ("googleId")`);
        await queryRunner.query(`ALTER TABLE "auth_users" ALTER COLUMN "passwordHash" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "auth_users" ALTER COLUMN "passwordHash" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "auth_users" DROP CONSTRAINT "UQ_2912c716163af3aaa0cbe4eb8e1"`);
        await queryRunner.query(`ALTER TABLE "auth_users" DROP COLUMN "googleId"`);
    }

}
