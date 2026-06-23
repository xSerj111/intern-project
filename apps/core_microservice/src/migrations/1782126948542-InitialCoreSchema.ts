import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialCoreSchema1782126948542 implements MigrationInterface {
    name = 'InitialCoreSchema1782126948542'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "likes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_a9323de3f8bced7539a794b4a37" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cfd8e81fac09d7339a32e57d90" ON "likes"  ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_74b9b8cd79a1014e50135f266f" ON "likes"  ("postId", "userId") `);
        await queryRunner.query(`CREATE TABLE "posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "authorId" uuid NOT NULL, "content" text NOT NULL, "mediaUrls" text array NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_2829ac61eff60fcec60d7274b9e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c5a322ad12a7bf95460c958e80" ON "posts"  ("authorId") `);
        await queryRunner.query(`CREATE TABLE "comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "authorId" uuid NOT NULL, "content" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4548cc4a409b8651ec75f70e28" ON "comments"  ("authorId") `);
        await queryRunner.query(`CREATE TABLE "follows" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "followerId" uuid NOT NULL, "followingId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_8988f607744e16ff79da3b8a627" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fdb91868b03a2040db408a5333" ON "follows"  ("followerId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ef463dd9a2ce0d673350e36e0f" ON "follows"  ("followingId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_105079775692df1f8799ed0fac" ON "follows"  ("followerId", "followingId") `);
        await queryRunner.query(`CREATE TABLE "user_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "authUserId" uuid NOT NULL, "username" character varying(50) NOT NULL, "displayName" character varying(100) NOT NULL, "bio" text, "avatarUrl" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_3a31e0a315109d8f5fbadbb933e" UNIQUE ("authUserId"), CONSTRAINT "UQ_7bdaa0714f4c1087a926a2d8369" UNIQUE ("username"), CONSTRAINT "PK_1ec6662219f4605723f1e41b6cb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3a31e0a315109d8f5fbadbb933" ON "user_profiles"  ("authUserId") `);
        await queryRunner.query(`ALTER TABLE "likes" ADD CONSTRAINT "FK_e2fe567ad8d305fefc918d44f50" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_e44ddaaa6d058cb4092f83ad61f" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_e44ddaaa6d058cb4092f83ad61f"`);
        await queryRunner.query(`ALTER TABLE "likes" DROP CONSTRAINT "FK_e2fe567ad8d305fefc918d44f50"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a31e0a315109d8f5fbadbb933"`);
        await queryRunner.query(`DROP TABLE "user_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_105079775692df1f8799ed0fac"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ef463dd9a2ce0d673350e36e0f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fdb91868b03a2040db408a5333"`);
        await queryRunner.query(`DROP TABLE "follows"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4548cc4a409b8651ec75f70e28"`);
        await queryRunner.query(`DROP TABLE "comments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c5a322ad12a7bf95460c958e80"`);
        await queryRunner.query(`DROP TABLE "posts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_74b9b8cd79a1014e50135f266f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cfd8e81fac09d7339a32e57d90"`);
        await queryRunner.query(`DROP TABLE "likes"`);
    }

}
