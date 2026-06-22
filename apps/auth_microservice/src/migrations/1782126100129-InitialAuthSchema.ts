import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialAuthSchema1782126100129 implements MigrationInterface {
    name = 'InitialAuthSchema1782126100129'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "auth_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "passwordHash" character varying NOT NULL, "isEmailVerified" boolean NOT NULL DEFAULT false, "roles" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_13d8b49e55a8b06bee6bbc828fb" UNIQUE ("email"), CONSTRAINT "PK_c88cc8077366b470dafc2917366" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "auth_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "refreshToken" character varying NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "ipAddress" character varying, "userAgent" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid, CONSTRAINT "PK_641507381f32580e8479efc36cd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "auth_sessions" ADD CONSTRAINT "FK_925b24d7fc2f9324ce972aee025" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "auth_sessions" DROP CONSTRAINT "FK_925b24d7fc2f9324ce972aee025"`);
        await queryRunner.query(`DROP TABLE "auth_sessions"`);
        await queryRunner.query(`DROP TABLE "auth_users"`);
    }

}
