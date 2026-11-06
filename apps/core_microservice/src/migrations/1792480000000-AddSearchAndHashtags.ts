import { MigrationInterface, QueryRunner } from 'typeorm';

const BACKFILL_CHUNK_SIZE = 500;

/*
 * Frozen copy of the hashtag rule (`@repo/contracts` `HASHTAG_PATTERN_SOURCE`
 * / `normalizeHashtag`, core `extractHashtags` / `MAX_HASHTAGS_PER_POST`) as of
 * this migration. Inlined on purpose: a migration is a snapshot, so a later
 * change to the live rule must not change what this backfill computes.
 */
const HASHTAG_PATTERN_SOURCE =
  '(?<![\\p{L}\\p{N}_/])#([\\p{L}\\p{N}_]{1,50})(?![\\p{L}\\p{N}_])';
const MAX_HASHTAGS_PER_POST = 20;

function extractHashtags(content: string): string[] {
  const tags = new Set<string>();
  // NFC first: an NFD "é" (e + combining mark) is not in [\p{L}\p{N}_] and
  // would cut `#café` to `cafe`.
  for (const match of content
    .normalize('NFC')
    .matchAll(new RegExp(HASHTAG_PATTERN_SOURCE, 'gu'))) {
    tags.add(match[1].normalize('NFC').toLowerCase());
    if (tags.size === MAX_HASHTAGS_PER_POST) break;
  }
  return [...tags];
}

interface PostContentRow {
  id: string;
  content: string;
}

/**
 * Search: `posts.hashtags` with a backfill, and trigram/GIN
 * indexes for people, post and hashtag search.
 *
 * Partial predicates mirror the search queries exactly (`status = 'published'`
 * inlined, `"deletedAt" IS NULL`) so the planner can use them. The trigram
 * index on `lower("username")` also serves prefix LIKE, so it replaces
 * `IDX_user_profiles_username_lower`. Volumes are small, so this runs in a
 * transaction; switch to `transaction = false` + `CONCURRENTLY` for a large
 * table.
 */
export class AddSearchAndHashtags1792480000000 implements MigrationInterface {
  name = 'AddSearchAndHashtags1792480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `ALTER TABLE "posts" ADD COLUMN "hashtags" text[] NOT NULL DEFAULT '{}'`,
    );

    await this.backfillHashtags(queryRunner);

    await queryRunner.query(
      `CREATE INDEX "IDX_user_profiles_username_trgm" ON "user_profiles" USING GIN (lower("username") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_profiles_display_name_trgm" ON "user_profiles" USING GIN (lower("displayName") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_posts_content_trgm" ON "posts" USING GIN ("content" gin_trgm_ops) WHERE "status" = 'published' AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_posts_hashtags" ON "posts" USING GIN ("hashtags") WHERE "status" = 'published' AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_profiles_username_lower"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_user_profiles_username_lower" ON "user_profiles" (lower("username") text_pattern_ops)`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_hashtags"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_content_trgm"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_profiles_display_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_profiles_username_trgm"`,
    );
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "hashtags"`);
    // pg_trgm stays: other objects may depend on it, and dropping an
    // extension this migration may not have created could break them.
  }

  /** Keyset-paged over every row (soft-deleted too); rows without tags keep `'{}'`. */
  private async backfillHashtags(queryRunner: QueryRunner): Promise<void> {
    let lastId: string | null = null;
    for (;;) {
      const rows = (
        lastId === null
          ? await queryRunner.query(
              `SELECT "id", "content" FROM "posts" ORDER BY "id" LIMIT $1`,
              [BACKFILL_CHUNK_SIZE],
            )
          : await queryRunner.query(
              `SELECT "id", "content" FROM "posts" WHERE "id" > $1 ORDER BY "id" LIMIT $2`,
              [lastId, BACKFILL_CHUNK_SIZE],
            )
      ) as PostContentRow[];
      if (rows.length === 0) return;

      for (const row of rows) {
        const tags = extractHashtags(row.content);
        if (tags.length === 0) continue;
        await queryRunner.query(
          `UPDATE "posts" SET "hashtags" = $2::text[] WHERE "id" = $1`,
          [row.id, tags],
        );
      }

      if (rows.length < BACKFILL_CHUNK_SIZE) return;
      lastId = rows[rows.length - 1].id;
    }
  }
}
