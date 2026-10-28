import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialNotificationSchema1782127369237 implements MigrationInterface {
  name = 'InitialNotificationSchema1782127369237';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" SERIAL NOT NULL, "recipientId" uuid NOT NULL, "type" character varying(50) NOT NULL, "payload" jsonb NOT NULL, "isRead" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db873ba9a123711a4bff527ccd" ON "notifications"  ("recipientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aef1c7aef3725068e5540f8f00" ON "notifications"  ("type") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aef1c7aef3725068e5540f8f00"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db873ba9a123711a4bff527ccd"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
