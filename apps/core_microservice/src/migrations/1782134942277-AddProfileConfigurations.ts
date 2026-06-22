import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProfileConfigurations1782134942277 implements MigrationInterface {
    name = 'AddProfileConfigurations1782134942277'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "profile_to_profile_configurations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actorId" uuid NOT NULL, "targetId" uuid NOT NULL, "isMuted" boolean NOT NULL DEFAULT false, "isBlocked" boolean NOT NULL DEFAULT false, "isCloseFriend" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9ba0ad1b44d08992352d4b011b0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0a77bee4b019695fb827f2aa04" ON "profile_to_profile_configurations"  ("actorId", "targetId") `);
        await queryRunner.query(`ALTER TABLE "profile_to_profile_configurations" ADD CONSTRAINT "FK_45337f6685d4dce74b707521cf7" FOREIGN KEY ("actorId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "profile_to_profile_configurations" ADD CONSTRAINT "FK_291f7082dd6e481496570358e87" FOREIGN KEY ("targetId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "profile_to_profile_configurations" DROP CONSTRAINT "FK_291f7082dd6e481496570358e87"`);
        await queryRunner.query(`ALTER TABLE "profile_to_profile_configurations" DROP CONSTRAINT "FK_45337f6685d4dce74b707521cf7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0a77bee4b019695fb827f2aa04"`);
        await queryRunner.query(`DROP TABLE "profile_to_profile_configurations"`);
    }

}
