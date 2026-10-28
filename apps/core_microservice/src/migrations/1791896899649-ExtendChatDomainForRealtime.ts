import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends the scaffolded chat tables for real-time messaging
 * (specs/003-realtime-chat/data-model.md):
 *
 * - `chats`: `title` capped at 100 chars, `directKey` (one DIRECT chat per pair), `createdById`, the per-chat
 *   `lastSeq` counter and `lastActivityAt` (list order).
 * - `chat_participants`: join/leave/read positions (`joinedSeq`, `leftAt`,
 *   `lastReadSeq`), `updatedAt`, and `joinedAt` as timestamptz (reset on
 *   re-join, still defaulting to now()).
 * - `messages`: `kind`, `seq`/`changeSeq` ordering and catch-up cursors,
 *   `clientMessageId` de-duplication, `editedAt` and `systemEvent`.
 * - `message_assets`: an asset belongs to at most one message.
 *
 * Existing rows are backfilled before the NOT NULL constraints and indexes are
 * applied. `messages.content` is already nullable, so it needs no change.
 */
export class ExtendChatDomainForRealtime1791896899649 implements MigrationInterface {
  name = 'ExtendChatDomainForRealtime1791896899649';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // chats: title cap and new columns (lastActivityAt nullable until backfilled).
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "title" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "directKey" character varying(73)`,
    );
    await queryRunner.query(`ALTER TABLE "chats" ADD "createdById" uuid`);
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "lastSeq" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "lastActivityAt" TIMESTAMP WITH TIME ZONE`,
    );

    // chat_participants: new columns; joinedAt becomes timestamptz.
    await queryRunner.query(
      `ALTER TABLE "chat_participants" ADD "joinedSeq" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" ADD "leftAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" ADD "lastReadSeq" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" ALTER COLUMN "joinedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    // messages: new columns (seq/changeSeq nullable until backfilled).
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "kind" character varying(10) NOT NULL DEFAULT 'USER'`,
    );
    await queryRunner.query(`ALTER TABLE "messages" ADD "seq" bigint`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "changeSeq" bigint`);
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "clientMessageId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "editedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "messages" ADD "systemEvent" jsonb`);

    // Backfill: per-chat message order, chat counters and activity time.
    await queryRunner.query(
      `UPDATE "messages" m SET "seq" = r."rn", "changeSeq" = r."rn"
       FROM (
         SELECT "id", ROW_NUMBER() OVER (PARTITION BY "chatId" ORDER BY "createdAt", "id") AS "rn"
         FROM "messages"
       ) r
       WHERE m."id" = r."id"`,
    );
    await queryRunner.query(
      `UPDATE "chats" c SET "lastSeq" = s."maxSeq"
       FROM (SELECT "chatId", MAX("seq") AS "maxSeq" FROM "messages" GROUP BY "chatId") s
       WHERE c."id" = s."chatId"`,
    );
    await queryRunner.query(
      `UPDATE "chats" SET "lastActivityAt" = "updatedAt"`,
    );
    // Best-effort creator: the earliest admin, else the earliest participant.
    await queryRunner.query(
      `UPDATE "chats" c SET "createdById" = (
         SELECT p."userId" FROM "chat_participants" p
         WHERE p."chatId" = c."id"
         ORDER BY (p."role" = 'ADMIN') DESC, p."joinedAt", p."userId"
         LIMIT 1
       )`,
    );

    // Constraints now that every row has a value.
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "lastActivityAt" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "lastActivityAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ALTER COLUMN "seq" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ALTER COLUMN "changeSeq" SET NOT NULL`,
    );

    // Indexes.
    await queryRunner.query(
      `ALTER TABLE "chats" ADD CONSTRAINT "UQ_chats_directKey" UNIQUE ("directKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chats_lastActivityAt" ON "chats" ("lastActivityAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_participants_userId_active" ON "chat_participants" ("userId") WHERE "leftAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_messages_chatId_seq" ON "messages" ("chatId", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_chatId_changeSeq" ON "messages" ("chatId", "changeSeq")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_messages_chatId_authorId_clientMessageId" ON "messages" ("chatId", "authorId", "clientMessageId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_message_assets_assetId" ON "message_assets" ("assetId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_message_assets_assetId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_messages_chatId_authorId_clientMessageId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_messages_chatId_changeSeq"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_chatId_seq"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_chat_participants_userId_active"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_chats_lastActivityAt"`);
    await queryRunner.query(
      `ALTER TABLE "chats" DROP CONSTRAINT "UQ_chats_directKey"`,
    );

    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "systemEvent"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "editedAt"`);
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN "clientMessageId"`,
    );
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "changeSeq"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "seq"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "kind"`);

    await queryRunner.query(
      `ALTER TABLE "chat_participants" ALTER COLUMN "joinedAt" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" DROP COLUMN "lastReadSeq"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" DROP COLUMN "leftAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_participants" DROP COLUMN "joinedSeq"`,
    );

    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "lastActivityAt"`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "lastSeq"`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "createdById"`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "directKey"`);
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "title" TYPE character varying`,
    );
  }
}
