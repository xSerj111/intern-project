import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationsV21787000000000 implements MigrationInterface {
  name = 'NotificationsV21787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // The stub table was never written to; drop and recreate with UUID keys.
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aef1c7aef3725068e5540f8f00"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db873ba9a123711a4bff527ccd"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);

    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recipientId" uuid NOT NULL, "actorId" uuid NOT NULL, "kind" character varying(30) NOT NULL, "targetType" character varying(10) NOT NULL, "targetId" uuid NOT NULL, "postId" uuid, "actorSnapshot" jsonb NOT NULL, "excerpt" character varying(140), "sourceEventId" uuid NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "seenAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_notifications_sourceEventId" UNIQUE ("sourceEventId"), CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipientId_occurredAt" ON "notifications" ("recipientId", "occurredAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipientId_unseen" ON "notifications" ("recipientId") WHERE "seenAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_notifications_recipientId_kind_actorId_targetId" ON "notifications" ("recipientId", "kind", "actorId", "targetId") WHERE kind IN ('POST_LIKED','COMMENT_LIKED')`,
    );

    await queryRunner.query(
      `CREATE TABLE "notification_preferences" ("userId" uuid NOT NULL, "emailMessages" boolean NOT NULL DEFAULT true, "emailComments" boolean NOT NULL DEFAULT true, "emailLikes" boolean NOT NULL DEFAULT true, "emailFollows" boolean NOT NULL DEFAULT true, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_preferences_userId" PRIMARY KEY ("userId"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "processed_events" ("eventId" uuid NOT NULL, "routingKey" character varying(100) NOT NULL, "followUpDone" boolean NOT NULL DEFAULT false, "processedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_processed_events_eventId" PRIMARY KEY ("eventId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_processed_events_processedAt" ON "processed_events" ("processedAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "email_deliveries" ("jobId" character varying(80) NOT NULL, "recipientId" uuid NOT NULL, "kind" character varying(30) NOT NULL, "status" character varying(10) NOT NULL, "attempts" integer NOT NULL DEFAULT 0, "lastError" text, "sentAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_email_deliveries_jobId" PRIMARY KEY ("jobId"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "recipient_contacts" ("userId" uuid NOT NULL, "email" character varying(255) NOT NULL, "fetchedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_recipient_contacts_userId" PRIMARY KEY ("userId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "recipient_contacts"`);
    await queryRunner.query(`DROP TABLE "email_deliveries"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_processed_events_processedAt"`,
    );
    await queryRunner.query(`DROP TABLE "processed_events"`);
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_notifications_recipientId_kind_actorId_targetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notifications_recipientId_unseen"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notifications_recipientId_occurredAt"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);

    // Restore the stub table created by InitialNotificationSchema.
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
}
