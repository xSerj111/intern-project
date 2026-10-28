import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes for the paginated read paths (data-model §2).
 *
 * Partial predicates mirror the repository queries exactly so the planner can
 * use them: the feed inlines `status = 'published'`, comment reads filter on
 * `"deletedAt" IS NULL`. Volumes are small, so this runs in a transaction;
 * switch to `transaction = false` + `CONCURRENTLY` for a large table.
 */
export class AddPerformanceIndexes1792450000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1792450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_posts_feed" ON "posts" ("authorId", "createdAt" DESC, "id" DESC) WHERE "status" = 'published' AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_post_roots" ON "comments" ("postId", "createdAt" DESC, "id" DESC) WHERE "parentId" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_parent" ON "comments" ("parentId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follows_following_created" ON "follows" ("followingId", "createdAt" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follows_follower_created" ON "follows" ("followerId", "createdAt" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_profiles_username_lower" ON "user_profiles" (lower("username") text_pattern_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_profiles_username_lower"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_follows_follower_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_follows_following_created"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_comments_parent"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_comments_post_roots"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_feed"`);
  }
}
