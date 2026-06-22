import { MigrationInterface, QueryRunner } from "typeorm";

export class ScaffoldChatDomain1782136240403 implements MigrationInterface {
    name = 'ScaffoldChatDomain1782136240403'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "chats" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(20) NOT NULL DEFAULT 'DIRECT', "title" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "chat_participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatId" uuid NOT NULL, "userId" uuid NOT NULL, "role" character varying(20) NOT NULL DEFAULT 'MEMBER', "joinedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ebf68c52a2b4dceb777672b782d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d3101b19215e8540d891f98c06" ON "chat_participants"  ("chatId", "userId") `);
        await queryRunner.query(`CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatId" uuid NOT NULL, "authorId" uuid NOT NULL, "content" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_36bc604c820bb9adc4c75cd411" ON "messages"  ("chatId") `);
        await queryRunner.query(`CREATE INDEX "IDX_819e6bb0ee78baf73c398dc707" ON "messages"  ("authorId") `);
        await queryRunner.query(`CREATE TABLE "message_assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "messageId" uuid NOT NULL, "assetId" uuid NOT NULL, "displayOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f7b9bbeae429a2a0e8b6356b1f3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8a73cde95259917fb7ca1f9aa6" ON "message_assets"  ("messageId", "assetId") `);
        await queryRunner.query(`ALTER TABLE "chat_participants" ADD CONSTRAINT "FK_e16675fae83bc603f30ae8fbdd5" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_participants" ADD CONSTRAINT "FK_fb6add83b1a7acc94433d385692" FOREIGN KEY ("userId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_36bc604c820bb9adc4c75cd4115" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_819e6bb0ee78baf73c398dc707f" FOREIGN KEY ("authorId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_assets" ADD CONSTRAINT "FK_0b9c61b7ec6f1e8721932e9717b" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_assets" ADD CONSTRAINT "FK_115da0ff584a52b432bf4b844b0" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "message_assets" DROP CONSTRAINT "FK_115da0ff584a52b432bf4b844b0"`);
        await queryRunner.query(`ALTER TABLE "message_assets" DROP CONSTRAINT "FK_0b9c61b7ec6f1e8721932e9717b"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_819e6bb0ee78baf73c398dc707f"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_36bc604c820bb9adc4c75cd4115"`);
        await queryRunner.query(`ALTER TABLE "chat_participants" DROP CONSTRAINT "FK_fb6add83b1a7acc94433d385692"`);
        await queryRunner.query(`ALTER TABLE "chat_participants" DROP CONSTRAINT "FK_e16675fae83bc603f30ae8fbdd5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8a73cde95259917fb7ca1f9aa6"`);
        await queryRunner.query(`DROP TABLE "message_assets"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_819e6bb0ee78baf73c398dc707"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36bc604c820bb9adc4c75cd411"`);
        await queryRunner.query(`DROP TABLE "messages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d3101b19215e8540d891f98c06"`);
        await queryRunner.query(`DROP TABLE "chat_participants"`);
        await queryRunner.query(`DROP TABLE "chats"`);
    }

}
