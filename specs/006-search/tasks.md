---
description: "Task list for search: people, posts and hashtags (Postgres pg_trgm)"
---

# Tasks: Search — people, posts and hashtags

**Input**: [plan.md](./plan.md). It holds the context, the decisions (scope, placement, engine, signed-out access, tag shape) and the "Why not Elasticsearch" reasoning. There is no spec.md: this feature was planned directly, not through spec-kit. The user stories below are derived from plan.md; `§n` refers to its numbered sections.

**Commit prefix**: `feat(searchAndTags)`

**Tests**: requested by plan.md ("Tests and docs"). Specs are written in the same task as the code they cover (spec first, see it fail, then implement).

## User stories (derived from plan.md)

| ID | Story | Priority | plan.md |
|----|-------|----------|---------|
| US1 | Find people by any part of their username or display name, with exact and prefix matches ranked first | P1 | §3 |
| US2 | Search published posts by keyword; `%` and `_` match themselves, and the query can use a trigram index | P1 | §4 |
| US3 | Posts carry hashtags. Tags can be searched by prefix and browsed as a public tag feed | P2 | §1, §2, §5 |
| US4 | A search bar above the feed, a `/search` page with People, Posts and Tags tabs, and a Search nav entry | P2 | §6–§9 |
| US5 | `#tag` in post and comment text links to a public `/tags/{tag}` feed page | P3 | §7 (hashtag links), §8 (tag feed) |

**Acceptance criteria**:
- [ ] People search matches the middle of a username and display names; current callers (chat dialogs, mention resolution) still get the exact username first
- [ ] Post search escapes `%`/`_` and `EXPLAIN ANALYZE` shows `IDX_posts_content_trgm`
- [ ] Hashtags are extracted on create and on edit; tag search and the tag feed work signed out
- [ ] Search is reachable from the home bar and the nav, at desktop and at phone width, signed in and signed out
- [ ] `migration:run` → `migration:revert` → `migration:run` works, and the revert brings `IDX_user_profiles_username_lower` back

## Format: `[ID] [tags] Description`

- **[P]**: can run in parallel with the other `[P]` tasks of the same wave (different files)
- **[US1]…[US5]**: the user story the task belongs to (story phases only)
- **[opus] / [sonnet] / [haiku]**: model hint for the lane. Missing hint → sonnet
- **[orch]**: the orchestrator does it itself (install, package build, migrations, one-line registrations, small shared-file edits)
- **[gate]**: covered by the batch gate; marked when the gate passes
- **[evidence]**: needs running services; the result goes in `specs/006-search/impl/run/<batch>-evidence.md`
- **[human]**: only the user can do it (browser check, CI push, a decision). Never done or marked by the orchestrator or a lane
- Paths are relative to the repo root. `C` = `apps/core_microservice`, `W` = `apps/client_app` (in prose only; tasks spell the full path)

## Batch mapping

| Batch | Title | Tasks | Mode |
|-------|-------|-------|------|
| B1 | Foundation: contracts, LIKE helper, migration, hashtag domain | T001–T014 | lanes |
| B2 | People and post search (backend) | T015–T024 | lanes |
| B3 | Hashtag endpoints and seeds | T025–T037 | lanes |
| B4 | Client: test setup, API layer, search UI, nav, hashtag links and tag feed | T038–T057 | lanes |
| B5 | Browser E2E, docs and verification | T058–T068 | solo |

Task IDs are stable: dropped tasks leave gaps (T011, T022, T036, T050, T055, T056, T065) and T049 is listed right after T038, whose lane it shares.

**Mode**: `lanes` = the orchestrator dispatches `task-implementer` lanes. `solo` = the orchestrator implements the code tasks itself, in the main session (tasks tagged with a model may still go to a lane; everything else is the orchestrator's).

## Ground rules for every task

- Read `DDD_ARCHITECTURE_GUIDE.md` (only the section you need) before touching core. `modules/profiles` is the reference layout. Business rules live on the entity (`Post.create()`, `Post.editContent()`), not in services. Domain code throws `DomainError` subclasses, never `HttpException`.
- Behaviour must not change unless the task says so. Every existing unit and e2e suite must still pass. The `/profiles/search` and `/posts/search` response shapes do not change.
- `@repo/shared` is backend-only; `@repo/contracts` is the only package the client imports, and it stays zero-dependency.
- After changing `packages/contracts` or `packages/shared`, the orchestrator runs `npm run build -w @repo/contracts -w @repo/shared` before apps are built or tested.
- Every LIKE/ILIKE pattern built from user input goes through `escapeLikePattern` (from `apps/core_microservice/src/common/db/like-pattern.ts` after T004) with `ESCAPE '\'`. Never interpolate user input into SQL; always bind parameters.
- Queries meant to use a partial index write `status = 'published'` literally into the SQL (as `findFeedPage` does, see the comment near `post.repository.ts:54`) and filter `"deletedAt" IS NULL`, so the planner can match the index predicate.
- Every new route has full Swagger decorators (`@ApiOperation`, `@ApiOkResponse` with a DTO type, `@ApiQuery`/`@ApiParam`, `@ApiBadRequestResponse`). `test/openapi.e2e-spec.ts` fails on undocumented routes.
- `limit` caps use `PAGE_SIZE_MAX` from `@repo/contracts`. Out-of-range values are rejected with 400, never clamped.
- Client: CSS Modules with the tokens from `apps/client_app/src/app/globals.css`; reuse `ui/input`, `ui/tabs`, `ui/empty-state`, `ui/skeleton`; icons from `lucide-react`.
- Never run `npm run lint` (it runs `--fix`). Use `npm run lint:check -w <app>` or `npx eslint <files>`.
- Never `docker compose down -v` the default project.
- Commit messages carry no Co-Authored-By/Claude line.
- Prettier: `singleQuote: true`, `trailingComma: "all"`.

---

## Phase 1: Setup — Batch B1

**Purpose**: shared wire types and the hashtag rule in `@repo/contracts`, plus the LIKE-escaping helper in core. All later work builds on these.

- [X] T001 [P] [sonnet] (wave 1) Hashtag rule in contracts. Create `packages/contracts/src/posts/hashtags.ts` exporting:
  - `HASHTAG_MAX_LENGTH = 50`.
  - `HASHTAG_PATTERN_SOURCE = '(?<![\\p{L}\\p{N}_/])#([\\p{L}\\p{N}_]{1,50})(?![\\p{L}\\p{N}_])'`, a **string**, not a `RegExp`, so each caller builds its own `new RegExp(HASHTAG_PATTERN_SOURCE, 'gu')` and no `lastIndex` state is shared. Add a doc comment explaining the lookbehind (Unicode classes because JS `\w` is ASCII-only, so `café#x` is not a tag; `/` so `example.com/#section` is not a tag) and the lookahead (a run over 50 chars is not a tag at all, rather than being cut off).
  - `HASHTAG_TAG_PATTERN_SOURCE = '^[\\p{L}\\p{N}_]{1,50}$'` (used with `u`) for validating a single normalized tag.
  - `normalizeHashtag(raw: string): string`: strip one leading `#`, then `.normalize('NFC').toLowerCase()`.
  - Re-export from `packages/contracts/src/posts/index.ts`. No dependencies may be added to `packages/contracts/package.json`
- [X] T002 [P] [sonnet] (wave 1) Search wire types in contracts:
  - `packages/contracts/src/posts/responses.ts`: add `IHashtagResult { tag: string; postCount: number }` and `IPostSearchPage { items: IPostResponse[]; total: number; page: number; limit: number }` (match the fields `PostSearchResponseDto` in `apps/core_microservice/src/modules/posts/dto/post-search-response.dto.ts` returns today).
  - `packages/contracts/src/posts/requests.ts`: add `ISearchHashtagsQuery { q: string; limit?: number }` and `IHashtagFeedQuery { cursor?: string; limit?: number }`.
  - `packages/contracts/src/profiles/requests.ts:26-33` (`ISearchProfilesQuery`): change the doc from "username prefix" to "any part of the username or display name", and fix the stated range to the one `apps/core_microservice/src/modules/profiles/dto/search-profiles-query.dto.ts` actually enforces (min 2, max 50; check the DTO).
  - Export everything new from the package index files
- [X] T003 [orch] `npm run build -w @repo/contracts -w @repo/shared` after T001/T002
- [X] T004 [P] [sonnet] (wave 1) Move `escapeLikePattern` out of `apps/core_microservice/src/modules/profiles/infrastructure/repository/user-profile.repository.ts` into `apps/core_microservice/src/common/db/like-pattern.ts` (same implementation; doc comment: escapes `\`, `%`, `_` for use with `ESCAPE '\'`). Move its `describe('escapeLikePattern')` cases from `user-profile.repository.spec.ts` into a new `apps/core_microservice/src/common/db/like-pattern.spec.ts`. Update the import in `user-profile.repository.ts` and its spec; `grep -rn escapeLikePattern apps/core_microservice/src` must show no other importer of the old path. No behaviour change

**Checkpoint**: contracts build and export the hashtag rule and search types; `escapeLikePattern` lives in `common/db`.

---

## Phase 2: Foundational — Batch B1

**Purpose**: the schema (extension, `hashtags` column, trigram and array indexes) and the hashtag domain logic that US1–US3 need.

**⚠️ CRITICAL**: B2 and later batches assume these are merged and the migration has run.

- [X] T005 [P] [sonnet] (wave 2) Hashtag extraction. Create `apps/core_microservice/src/modules/posts/domain/hashtags.ts` with `MAX_HASHTAGS_PER_POST = 20` and `extractHashtags(content: string): string[]`: build `new RegExp(HASHTAG_PATTERN_SOURCE, 'gu')` from `@repo/contracts` inside the function, take capture group 1 of each match, apply `normalizeHashtag`, keep distinct values in order of first appearance, stop at 20. Write `hashtags.spec.ts` next to it **first**, covering: `#café` is a tag; `café#x` and `example.com/#x` are not; a 51-character run is not a tag at all (no 50-char truncation); a 50-character run is; digit-only `#2024` is a tag; `#Tag #tag #TAG` and the NFC/NFD forms of `#café` collapse to one; 25 distinct tags → first 20; empty and tag-free content → `[]`; punctuation after the tag (`#tag,` `#tag.` `(#tag)`) ends the tag. Also add a `normalizeHashtag` spec here (it imports from contracts): leading `#` stripped once, lowercased, NFC
- [X] T006 [sonnet] `Post` entity hashtags (wave 2, after T005). In `apps/core_microservice/src/modules/posts/domain/entities/post.entity.ts` add `@Column('text', { array: true, default: () => "'{}'" }) hashtags!: string[]`; do **not** add it to `PostProps` (that type only types `TypeormRepositoryBase` query params, not constructor input). `Post.create()` sets `hashtags = extractHashtags(content)`. Add `editContent(content: string): void` that sets `content` and recomputes `hashtags` (apply the same content rules `create()` applies, if any). Extend `post.entity.spec.ts`: tags set by `create`, replaced by `editContent`, and `[]` when content has none. Done-check runs the full core unit suite (`npx jest`), so any spec that breaks on the new field is fixed in this lane
- [X] T007 [sonnet] (wave 2) `PostsService.updatePost` (`apps/core_microservice/src/modules/posts/posts.service.ts:136-147`): replace `post.content = updatePostDto.content` with `post.editContent(updatePostDto.content)`. Extend `posts.service.spec.ts`: updating content recomputes `hashtags` on the saved entity. Same lane as T006
- [X] T008 [opus] (wave 2) Migration `apps/core_microservice/src/migrations/1792480000000-AddSearchAndHashtags.ts` (timestamp after `1792470000000-AddOutboxCorrelationId.ts`; follow the style of `1792450000000-AddPerformanceIndexes.ts`). `up()`:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
  - `ALTER TABLE "posts" ADD COLUMN "hashtags" text[] NOT NULL DEFAULT '{}'`.
  - Backfill in TypeScript: page through `SELECT id, content FROM posts ORDER BY id` in chunks of 500 (keyset on `id`), compute tags with an **inlined copy** of the regex and normalization from T001/T005 (both boundaries, NFC, lowercase, distinct, cap 20; a comment says it is a frozen copy on purpose because migrations are snapshots, so don't import from `@repo/contracts` or the domain), and `UPDATE posts SET hashtags = v.tags FROM (SELECT unnest($1::uuid[]) id, …)` per chunk (or one parameterized `UPDATE … WHERE id = $1` per row if simpler; skip rows with no tags).
  - Indexes, each partial predicate written exactly as the queries will write it:
    - `IDX_user_profiles_username_trgm`: `GIN (lower("username") gin_trgm_ops)` on `user_profiles`.
    - `IDX_user_profiles_display_name_trgm`: `GIN (lower("displayName") gin_trgm_ops)`.
    - `IDX_posts_content_trgm`: `GIN ("content" gin_trgm_ops) WHERE "status" = 'published' AND "deletedAt" IS NULL`.
    - `IDX_posts_hashtags`: `GIN ("hashtags") WHERE "status" = 'published' AND "deletedAt" IS NULL`.
  - `DROP INDEX "public"."IDX_user_profiles_username_lower"` (first `grep -rn "lower(.*username" apps/core_microservice/src` to confirm nothing else relies on a `lower(username)` prefix scan).
  - `down()`: drop the four new indexes and the `hashtags` column; recreate `IDX_user_profiles_username_lower` exactly as `1792450000000-AddPerformanceIndexes.ts:31` creates it (`(lower("username") text_pattern_ops)`). Keep the extension (comment why: dropping it can break other objects).
  - Confirm the column names (`displayName`, `deletedAt`, `status`) against the entities before writing SQL
- [X] T009 [orch] `cd apps/core_microservice && npm run migration:run && npm run migration:revert && npm run migration:run`; then `psql` check that `\d posts` has `hashtags` and that the four indexes exist. After the revert step, check `IDX_user_profiles_username_lower` exists again (record it in the batch entry)
- [X] T010 [sonnet] (wave 3, after T009 has run the migration) e2e coverage for the new column (repository rule): add `apps/core_microservice/test/search-hashtags.e2e-spec.ts` with a `describe('hashtags column')` block: creating a post via `POST /posts` with `#One #two` stores `hashtags = ['one','two']` (read it back through the repository or a raw query on the test data source); `PATCH /posts/:id` with new content replaces the tags. Use the helpers in `apps/core_microservice/test/helpers/` the same way `profile-posts.e2e-spec.ts` does. T031 adds more `describe` blocks to this file. Search e2e is split into `search-people`, `search-posts` and `search-hashtags` files so each lane owns one; `npm run test:e2e -- search` runs all three
- [X] T012 [gate] `npm run build -w @repo/contracts -w @repo/shared`; `npm run build -w core_microservice`; `npm run type-check -w core_microservice -w @repo/contracts`; `npm run lint:check -w core_microservice`; `cd apps/core_microservice && npm run test:cov` (70/60 thresholds); core e2e `search` and `profile-posts` suites; `migration:run`
- [X] T013 [orch] Global decision line in progress.md: the migration name, the four index names and their predicates, `escapeLikePattern` path, and `MAX_HASHTAGS_PER_POST`
- [X] T014 [orch] Point `.specify/feature.json` `feature_directory` at `specs/006-search` (needed by `/impl-batch`; done when tasks.md was generated)

**Checkpoint**: the schema is in place, the backfill populated existing posts, and creating or editing a post maintains `hashtags`.

---

## Phase 3: User Story 1 — People search by any part of username or display name (Priority: P1) 🎯 MVP — Batch B2

**Goal**: `GET /profiles/search?q=` matches infix on username **and** display name, ranked exact → prefix → similarity, served by the trigram indexes.

**Independent Test**: with profiles `alice` / "Alice Smith", `malice` / "Bob", `zed` / "Malicious Zed": `q=alice` returns `alice` first, then `malice`, then `zed` (display name match); `q=smith` returns `alice`; the caller is still excluded; `q=a_` does not match `abc`.

- [X] T015 [US1] [opus] Rewrite `searchByUsername` in `apps/core_microservice/src/modules/profiles/infrastructure/repository/user-profile.repository.ts` (lines ~51-67; keep the method name, port and signature so callers don't change):
  - `WHERE (lower(p.username) LIKE '%' || lower(:q) || '%' ESCAPE '\' OR lower(p."displayName") LIKE '%' || lower(:q) || '%' ESCAPE '\') AND p."authUserId" != :excludeAuthUserId`, with `q = escapeLikePattern(prefix)` (rename the parameter to `query`).
  - Ordering: `lower(p.username) = lower(:raw)` DESC, then `lower(p.username) LIKE lower(:q) || '%' ESCAPE '\'` DESC, then `greatest(similarity(lower(p.username), lower(:raw)), similarity(lower(coalesce(p."displayName", '')), lower(:raw)))` DESC, then `p.username` ASC. `:raw` is the unescaped query (bound, never interpolated). Use `addSelect(..., 'alias')` + `orderBy('alias')` if TypeORM refuses raw expressions in `orderBy`, and make sure `take(limit)` still produces one `LIMIT` (no `getMany` + pagination subquery surprises; check the generated SQL with `.getQuery()`).
  - Replace the comment about `IDX_user_profiles_username_lower` with one naming `IDX_user_profiles_username_trgm` / `IDX_user_profiles_display_name_trgm`, plus the known limit: a 2-char query has no full trigram, so the GIN index can't narrow it (fine at current volume; raise the minimum to 3 or add a prefix-only path if perf runs show a problem).
  - `user-profile.repository.spec.ts`: replace the prefix-LIKE assertion (lines ~41-47) with assertions for the infix `OR` condition, the escaped parameter and the ordering expressions
- [X] T016 [P] [US1] [haiku] Stale "prefix" wording, no behaviour change: the Swagger summary at `apps/core_microservice/src/modules/profiles/profiles.controller.ts:84`, the `@ApiProperty` description on `SearchProfilesQueryDto` in `apps/core_microservice/src/modules/profiles/dto/search-profiles-query.dto.ts`, the comment on `ProfilesService.searchProfiles` (`apps/core_microservice/src/modules/profiles/profiles.service.ts:231`), and the `searchProfiles` comment in `apps/client_app/src/lib/api/profile.ts:64`. All should say "username or display name contains". Run `grep -rni "prefix" apps/core_microservice/src/modules/profiles apps/client_app/src/lib/api/profile.ts` to catch the rest
- [X] T017 [US1] e2e in a new `apps/core_microservice/test/search-people.e2e-spec.ts`, `describe('GET /profiles/search')`: display-name match (`q` that appears only in a display name), infix username match, exact username ranked first over a longer infix match, `q=a_` does not match `abc` (escaping), the caller is excluded, and 400 for `q` under 2 chars. Same lane as T015 (repository rule)

**Checkpoint**: people search finds infix and display-name matches; `use-mention-profiles.ts` still resolves exact usernames (it picks the exact match out of the results).

---

## Phase 4: User Story 2 — Post keyword search (Priority: P1) — Batch B2

**Goal**: `GET /posts/search?keyword=` escapes the keyword, is served by `IDX_posts_content_trgm`, and is typed with a contract.

**Independent Test**: published posts "100% done" and "100 done" exist: `keyword=100%` returns only the first; a draft containing the keyword is not returned; signed out still works; paging returns `{items,total,page,limit}`.

- [X] T018 [US2] [opus] Rewrite `searchPublishedPosts` in `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts` (~line 139) with a query builder:
  - `p.content ILIKE '%' || :q || '%' ESCAPE '\'` with `q = escapeLikePattern(keyword)`.
  - `p.status = 'published'` written literally in the SQL (comment pointing at the `findFeedPage` comment and `IDX_posts_content_trgm`); soft-deleted rows excluded (`withDeleted` is not set, so TypeORM adds `"deletedAt" IS NULL`; confirm with `.getQuery()`).
  - Keep `leftJoinAndSelect` for `author` and `assets.asset`, ordering `p.createdAt DESC, p.id DESC`, and offset paging with `skip`/`take` + `getManyAndCount()` (with joined to-many relations `skip`/`take` are the correct TypeORM calls, not `offset`/`limit`).
  - Create `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.spec.ts` (none exists): mock the query builder like `user-profile.repository.spec.ts` does and assert the escaped parameter, the literal `status = 'published'` and the ordering
- [X] T019 [P] [US2] [sonnet] Type the endpoint: `PostsController.searchPosts` (`apps/core_microservice/src/modules/posts/posts.controller.ts:133`) returns `Promise<IPostSearchPage>`; make `PostSearchResponseDto` `implements IPostSearchPage`. Keep `SearchQueryDto` (`keyword` min 3) as is. Update `posts.controller.spec.ts` if the typing change requires it
- [X] T020 [US2] e2e in a new `apps/core_microservice/test/search-posts.e2e-spec.ts`, `describe('GET /posts/search')`: `keyword=100%` matches "100% done" but not "100 done"; `keyword=a_c` doesn't match "abc"; drafts and soft-deleted posts are excluded; works without a token; `likedByMe` is filled with a token; paging `page=2`. Same lane as T018
- [X] T021 [gate] `npm run build -w core_microservice`; `npm run type-check -w core_microservice -w client_app`; `npm run lint:check -w core_microservice -w client_app`; `cd apps/core_microservice && npm run test:cov`; core e2e `search`, `openapi`, `social`, `pagination`
- [ ] T023 [human] Open the "New message" dialog and the group dialog in the client and type part of a display name: the person appears. Type `@` + an exact username in a post: the mention still resolves
- [X] T024 [orch] Global decision line: the ordering contract of `/profiles/search` (exact → prefix → similarity → username) that the client and mention code rely on

**Checkpoint**: US1 and US2 work on their own through the existing endpoints; no client change is needed for them yet.

---

## Phase 5: User Story 3 — Hashtag search and tag feed API (Priority: P2) — Batch B3

**Goal**: `GET /hashtags/search?q=&limit=` and `GET /hashtags/:tag/posts?cursor=&limit=`, both public, documented and served from published, non-deleted posts.

**Independent Test**: signed out, after creating and publishing posts with `#Summer` (×2), `#summit` (×1) and a draft with `#summer`: `GET /hashtags/search?q=sum` → `[{tag:'summer',postCount:2},{tag:'summit',postCount:1}]`; `GET /hashtags/SUMMER/posts` → the two published posts, newest first; a bad cursor, `limit=0`, `limit=51` or tag `bad-tag` → 400.

### Wave 1 (domain, DTOs, port, mapper)

- [X] T025 [P] [US3] [sonnet] (wave 1) DTOs in `apps/core_microservice/src/modules/posts/dto/`, each with a spec:
  - `search-hashtags-query.dto.ts` (`implements ISearchHashtagsQuery`): `q` is transformed with `normalizeHashtag` (`@Transform`) and must then match `new RegExp(HASHTAG_TAG_PATTERN_SOURCE, 'u')` (so 1–50 chars of `[\p{L}\p{N}_]`); `limit` optional int, `@Min(1) @Max(PAGE_SIZE_MAX)`, default 10. `search-hashtags-query.dto.spec.ts`: `#Café` → `café`; `a b`, `a-b`, empty and 51 chars are rejected; `limit=0`/`51` rejected.
  - `hashtag-feed-query.dto.ts` (`implements IHashtagFeedQuery`): `cursor` with `@IsFeedCursor()` and `limit` exactly as `feed-query.dto.ts` does (reuse, don't copy validators). Spec mirrors `feed-query.dto.spec.ts`.
  - `hashtag-param.dto.ts`: `tag` path param normalized with `normalizeHashtag` and validated with the same pattern; invalid → 400. Spec includes an URL-decoded `café` and `%23tag` (decoded `#tag` → `tag`).
  - `hashtag-result.dto.ts` (`implements IHashtagResult`) with `@ApiProperty` on both fields
- [X] T026 [P] [US3] [sonnet] (wave 1) Extract `toResponses` from `PostsController` (`apps/core_microservice/src/modules/posts/posts.controller.ts:48`) into an injectable `PostResponseMapper` at `apps/core_microservice/src/modules/posts/post-response.mapper.ts` (`toResponses(posts, viewerId?)`, `toResponse(post, viewerId?)`), with the same like-stats and comment-count logic it has today. Inject it in `PostsController` (replace all 5 call sites), register it in `posts.module.ts` providers. Move the corresponding controller spec cases into `post-response.mapper.spec.ts`; `posts.controller.spec.ts` provides a mock or the real mapper. Behaviour unchanged
- [X] T027 [P] [US3] [sonnet] (wave 1) Port: add `searchHashtags(prefix: string, limit: number): Promise<{ tag: string; postCount: number }[]>` and `findByHashtagPage` to `apps/core_microservice/src/modules/posts/domain/interfaces/post-repository.port.ts`. `findFeedPage` takes `cursor: FeedCursor | null` and returns `{ posts: Post[]; nextCursor: string | null }`; use exactly that shape: `findByHashtagPage(tag: string, cursor: FeedCursor | null, limit: number): Promise<{ posts: Post[]; nextCursor: string | null }>`. Add stub implementations that throw `Error('not implemented')` in `post.repository.ts` only if needed for compilation in this wave (T028 replaces them)

### Wave 2 (repository, service, controller)

- [X] T028 [US3] [opus] (wave 2) Implement both methods in `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts`:
  - `searchHashtags`: raw query `SELECT tag, count(*)::int AS "postCount" FROM posts p, unnest(p.hashtags) AS tag WHERE p.status = 'published' AND p."deletedAt" IS NULL AND tag LIKE $1 || '%' ESCAPE '\' GROUP BY tag ORDER BY "postCount" DESC, tag ASC LIMIT $2`, with `$1 = escapeLikePattern(prefix)`. Comment with the plan's scaling note: the GIN array index can't serve a prefix match on unnested elements, so this scans published posts' tag arrays; move to a `hashtags(tag, post_count)` table maintained on publish/archive/delete if perf runs flag it.
  - `findByHashtagPage`: copy the **shape** of `findFeedPage` (ids query with the microsecond `to_char` keyset cursor on `createdAt DESC, id DESC`, `limit + 1` to detect the next page, then one hydration query with author and assets, re-ordered to match the ids) with `p.hashtags @> ARRAY[$tag]::text[]`, `p.status = 'published'` literal and `p."deletedAt" IS NULL`. Share only what is generic: extract the page slicing + `nextCursor` step and the hydrate-by-ids-in-order step (`findFeedPage` lines ~77-93) into private helpers both methods call. The ids query itself stays separate (the feed's follows `UNION` + `LATERAL` is feed-specific); don't try to generalize it.
  - Extend `post.repository.spec.ts` (from T018): escaped prefix, literal status, `@>` filter
- [X] T029 [US3] [sonnet] (wave 2) `PostsService` (`apps/core_microservice/src/modules/posts/posts.service.ts`): `searchHashtags(q, limit)` and `getHashtagFeed(tag, cursor, limit)` delegating to the port (decode the cursor with `FeedCursor` the same way the feed method does). Specs in `posts.service.spec.ts`. Same lane as T028
- [X] T030 [US3] [sonnet] (wave 2) `apps/core_microservice/src/modules/posts/hashtags.controller.ts`: `@ApiTags('hashtags') @Controller('hashtags')`, both routes `@UseGuards(OptionalJwtAuthGuard)` (`apps/core_microservice/src/common/auth/optional-jwt-auth.guard.ts`, used the way `posts.controller.ts` uses it on `search`):
  - `GET search` → `IHashtagResult[]` (`@ApiOkResponse({ type: [HashtagResultDto] })`).
  - `GET :tag/posts` → `IFeedPage` (reuse `FeedPageResponseDto`), items through `PostResponseMapper.toResponses(items, viewerId)` so `likedByMe`, like counts and comment counts are filled.
  - Full Swagger: `@ApiOperation`, `@ApiParam('tag')`, `@ApiQuery` for `q`/`cursor`/`limit`, `@ApiBadRequestResponse`.
  - Register the controller in `apps/core_microservice/src/modules/posts/posts.module.ts`. Make sure `/hashtags/search` is declared before `/hashtags/:tag/posts` (no clash today since the paths differ in length, but keep the order).
  - `hashtags.controller.spec.ts`: delegates with normalized params, maps through the mapper, passes `viewerId` when signed in and `undefined` when not
- [X] T031 [US3] (wave 2) e2e in `apps/core_microservice/test/search-hashtags.e2e-spec.ts` (from T010), `describe('hashtags')`: tags extracted on create and on edit (extend T010 if useful); `q=sum` counts only published, non-deleted posts; `q=a_` does not match `abc`; `q=#Sum` works (normalized); search and feed work without a token; feed keyset paging over 3+ posts with `limit=2` (no duplicates, no gaps, `nextCursor` null at the end); 400 for a bad cursor, `limit=0`, `limit=51`, and tag `bad-tag`; a post edited to drop the tag leaves the feed. Same lane as T028
- [X] T032 [orch] Boot check: run the `openapi` e2e suite alone after T030 (it fails on undocumented routes) and route any failure to the T030 lane

### Wave 2 (seeds, parallel with the API lane)

- [X] T033 [P] [US3] [sonnet] (wave 2) Dev seed `apps/core_microservice/seed/seed.ts` (~line 100-110): add `#tags` to several dev post contents (a few shared tags such as `#innogram`, `#travel`, one Unicode tag such as `#café`, one digit-only such as `#2024`), add `"hashtags"` to the `INSERT INTO posts` column list, and pass `extractHashtags(p.content)` (import from `../src/modules/posts/domain/hashtags`; check the seed's tsconfig/ts-node resolves `@repo/contracts` from there). Done-check: `npm run db:seed -w core_microservice` once against the dev DB, then `psql` `SELECT tag, count(*) FROM posts, unnest(hashtags) tag GROUP BY tag` shows the seeded tags (record the output in the Notes file; the client E2E relies on `#innogram`)
- [X] T034 [P] [US3] [sonnet] (wave 2) Perf seed `apps/core_microservice/seed/perf-profile.ts` (~line 521): add `hashtags` to the `posts` columns. Make a fixed pool of ~200 tags (deterministic, e.g. `tag000`–`tag199` mixed with ~20 word tags), give about half the posts 1–3 tags chosen with a skewed (e.g. Zipf-like) deterministic distribution from the seed's existing PRNG so a few tags are popular, append the tags to the content text, and compute the column with `extractHashtags(content)`. Keep the seed deterministic and its runtime about the same. Done-check: `npm run db:seed -w core_microservice -- --profile perf --reset` against a scratch DB **only if** the batch plan says so; otherwise `npx tsc --noEmit` on the seed and a dry count of tagged posts in the Notes file
- [X] T035 [gate] `npm run build -w core_microservice`; `type-check` and `lint:check` for core; `cd apps/core_microservice && npm run test:cov`; core e2e `search`, `openapi`, `profile-posts`, `social`, `pagination`
- [X] T037 [orch] Global decision lines: the hashtag routes and their DTO names, `PostResponseMapper` (path, method names), and the seed tags the client E2E can rely on

**Checkpoint**: the hashtag API is complete, documented and public; the seeds produce tagged posts.

---

## Phase 6: User Story 4 — Search bar, `/search` page and nav entry (Priority: P2) — Batch B4

**Goal**: anyone can search from the home feed or the nav and see People | Posts | Tags results; signed-out users get a log-in prompt on People.

**Independent Test**: signed in, type `ali` in the home bar, press Enter → `/search?q=ali&tab=people` lists matching profiles linking to `/profile/{userId}`; switch to Posts with a 3+ char query → post cards with "Load more"; Tags → `#tag · N posts` rows. Signed out, the same page works except People, which shows the log-in prompt. Short queries show a hint instead of results.

### Wave 1 (client test setup, API layer)

- [ ] T038 [P] [sonnet] (wave 1) Client Jest setup. In the `jest` block of `apps/client_app/package.json` add `"testEnvironment": "node"` and `"transform": { "^.+\\.tsx?$": ["ts-jest", { "tsconfig": { "module": "commonjs", "jsx": "react-jsx" } }] }`, and a `moduleNameMapper` for the `@/` path alias if `tsconfig.json` defines one (check). Add `"test:cov": "jest --coverage --passWithNoTests"` (no threshold) to its scripts, matching the existing `test` script. Check the installed jest / ts-jest versions are compatible (`npm ls jest ts-jest -w client_app`). Don't touch `.gitignore`: root `.gitignore` already ignores `coverage/`. Same lane as T049: done-check is `npx jest search-limits` passing, which is the client's first unit spec
- [ ] T049 [US4] [sonnet] (wave 1, same lane as T038, after the Jest setup) `apps/client_app/src/components/search/search-limits.ts`: `SEARCH_TABS = ['people','posts','tags'] as const`, `MIN_QUERY_LENGTH = { people: 2, posts: 3, tags: 1 }` (matching the backend DTOs: `SearchProfilesQueryDto` min, `SearchQueryDto` `keyword` min, hashtag `q` after normalization), `parseTab(value, signedIn)` (unknown or missing → `people` signed in, `posts` signed out) and `isQueryLongEnough(tab, q)` (tags: strip one leading `#` first). Spec `search-limits.spec.ts` next to it. T042 imports these instead of inlining the numbers
- [ ] T039 [orch] CI: add `- { name: client, ws: client_app, dir: apps/client_app }` to the `unit-tests` matrix in `.github/workflows/ci.yml` (after `shared`). The job already builds `@repo/contracts` and `@repo/shared` before the tests; nothing else needed
- [ ] T040 [P] [US4] [sonnet] (wave 1) `apps/client_app/src/lib/api/search.ts`: `searchPosts({ keyword, page, limit }, token?)` → `IPostSearchPage`, `searchHashtags({ q, limit }, token?)` → `IHashtagResult[]`, `getHashtagFeed(tag, { cursor, limit }, token?)` → `IFeedPage` (encode `tag` with `encodeURIComponent`), all through `coreApi` from `apps/client_app/src/lib/api/client.ts`, sending `Authorization` only when a token is given (copy how `apps/client_app/src/lib/api/feed.ts` handles the optional token). Add a `searchKeys` factory (`all`, `people(q)`, `posts(q)`, `tags(q)`, `tagFeed(tag)`) in the style of the existing key factories. People search reuses `searchProfiles()` from `apps/client_app/src/lib/api/profile.ts`; don't duplicate it

### Wave 2 (components, nav) and wave 3 (routes)

Wave 2 also runs Phase 7's T051+T052 and T053; wave 3 runs T043 and Phase 7's T054.

- [ ] T041 [P] [US4] [sonnet] (wave 2) `apps/client_app/src/components/search/search-bar.tsx` (+ `search-bar.module.css`), `'use client'`: a `<form role="search">` with the lucide `Search` icon and `ui/input`, `aria-label="Search"`, placeholder "Search people, posts and #tags". Props: `mode: 'navigate' | 'live'`. `navigate` (home): submit → `router.push('/search?q=' + encodeURIComponent(q))` (no-op on empty). `live` (`/search`): prefilled from `useSearchParams().get('q')`, updates `q` with `router.replace` (keeping `tab`) using the 250 ms debounce pattern from `apps/client_app/src/components/chat/new-direct-chat-dialog.tsx:99-102`; submit applies immediately
- [ ] T042 [P] [US4] [sonnet] (wave 2) `apps/client_app/src/components/search/search-results.tsx` (+ module CSS), `'use client'`: `ui/tabs` with **People | Posts | Tags**, active tab from `?tab=` (default `people` when signed in, `posts` when signed out), switching with `router.replace` keeping `q`. Minimum lengths: people 2, posts 3, tags 1 (after stripping a leading `#` for tags); below that render a hint ("Type at least N characters"). Each tab uses `useQuery`/`useInfiniteQuery` with `searchKeys`, shows `ui/skeleton` while loading and `ui/empty-state` for no results and errors.
  - **People**: only when signed in (use the auth hook the shell uses); rows link to `/profile/{userId}`, reusing `apps/client_app/src/components/chat/user-option.tsx` styling or a small `profile-row.tsx` in the same folder. Signed out → `EmptyState` with a link to `/login`.
  - **Posts**: `useInfiniteQuery` over `page` (next page while `page * limit < total`), rendering `PostCard` from `apps/client_app/src/components/posts/post-card.tsx`, with a "Load more" `ui/button`. Works signed out.
  - **Tags**: `#tag · N posts` rows (singular "post" for 1) linking to `/tags/${encodeURIComponent(tag)}`. Works signed out
- [ ] T043 [US4] [sonnet] Routes (wave 3, after T041/T042):
  - `apps/client_app/src/app/(app)/page.tsx`: render `<SearchBar mode="navigate" />` above `<FeedList />` for everyone; the page stays a server component (style it in `page.module.css`).
  - `apps/client_app/src/app/(app)/search/page.tsx` (+ `page.module.css`): `<Suspense>` wrapping `<SearchBar mode="live" />` and `<SearchResults />` (both use `useSearchParams`), `export const metadata = { title: 'Search' }` following the other pages. Public route: check `apps/client_app/src/app/(app)/layout.tsx` and any middleware for an auth redirect and make sure `/search` and `/tags/*` are not behind it
- [ ] T044 [US4] [sonnet] (wave 2) Nav entry in `useNavEntries()` (`apps/client_app/src/components/shell/app-shell.tsx:54-100`): add `{ key: 'search', label: 'Search', icon: Search, href: '/search', active: pathname.startsWith('/search') || pathname.startsWith('/tags') }` right after Home in **both** the signed-out and signed-in lists (import `Search` from `lucide-react`). The signed-in `BottomBar` now has 6 items: check `app-shell.module.css` at 375 px width; if items overflow or labels truncate badly, filter `search` out of the `BottomBar` entries only (the feed has the search bar) and say which in the lane report
- [ ] T045 [gate] (after wave 3, covers Phase 6 and Phase 7) `npm run build -w @repo/contracts`; `npm run type-check -w client_app`; `npm run lint:check -w client_app`; `AUTH_SERVICE_URL=http://localhost:3002 CORE_SERVICE_URL=http://localhost:3001 NOTIFICATIONS_SERVICE_URL=http://localhost:3003 npm run build -w client_app` (the env `ci.yml` sets); `npm run test:cov -w client_app` (the `search-limits` and parser specs run and pass)
- [ ] T046 [evidence] With core and the client running and the dev seed loaded, signed-out `curl` only (no Playwright; T059 covers the browser flow): `/search?q=inno&tab=posts` and `/tags/innogram` → 200 with no redirect to `/login`. Start what's missing with `IMPL_DIR=specs/006-search/impl scripts/impl-services.sh up auth core client` and stop only those with `down`. Record status lines
- [ ] T047 [human] Click through signed in and signed out at desktop and phone width: home bar → `/search`, tab switching keeps `q`, People prompt when signed out, Posts "Load more", the Search nav entry highlights on `/search`, and the bottom bar at 375 px looks right
- [ ] T048 [orch] Global decision line: the search URL contract (`/search?q=&tab=people|posts|tags`) and whether Search is in `BottomBar`

**Checkpoint**: search is usable end to end from the UI for people, posts and tags; tags link to the tag feed built in Phase 7 of the same batch.

---

## Phase 7: User Story 5 — Hashtag links and the tag feed page (Priority: P3) — Batch B4 (waves 2–3)

T051+T052 and T053 run in B4 wave 2 (they need only T038 and T040), T054 in wave 3. The gate is T045.

**Goal**: `#tag` in posts, post details and comments is a link, and `/tags/{tag}` shows a public, infinitely scrolling feed of that tag.

**Independent Test**: a post with `see #Summer and example.com/#x, mail a#b@x.io` renders `#Summer` as a link to `/tags/summer` and leaves the URL fragment and email as text; opening `/tags/summer` signed out shows a `#summer` header and the published posts, newest first, loading more on scroll; signed in, liked posts show as liked.

- [ ] T051 [P] [US5] [sonnet] (wave 2) Parser: extend `splitMentions` in `apps/client_app/src/components/mentions/mention-parser.ts` to also emit `{ type: 'hashtag', value: string, tag: string }` parts, using `new RegExp(HASHTAG_PATTERN_SOURCE, 'gu')` from `@repo/contracts` (built inside the function) and `tag = normalizeHashtag(match[1])`. Merge mention and hashtag matches by index so parts stay in order and never overlap; keep the existing mention behaviour and part type names unchanged. Write `apps/client_app/src/components/mentions/mention-parser.spec.ts` **first**: plain text; mentions only; hashtags only; mixed order; `#Café` → tag `café`; `example.com/#x`, `café#x` and `user#1@mail.com`-style emails stay text; a 51-char run stays text; adjacent `@a #b`
- [ ] T052 [US5] [sonnet] (wave 2) Render: in `apps/client_app/src/components/mentions/mention-text.tsx` render hashtag parts as `<Link href={`/tags/${encodeURIComponent(part.tag)}`}>{part.value}</Link>` (Next `Link`), styled like mentions in `mentions.module.css` (add a `.hashtag` class if the mention class is too specific). Stop propagation the same way mention links do if post cards are clickable. Same lane as T051. Check `post-card.tsx`, `post-detail.tsx` and the comments component all render through `MentionText` (`grep -rn MentionText apps/client_app/src`); report any that don't
- [ ] T053 [P] [US5] [sonnet] (wave 2) Feed list reuse: refactor `apps/client_app/src/components/feed/feed-list.tsx` so `FeedList` accepts optional `queryKey` and `fetchPage(cursor, token?) => Promise<IFeedPage>` props, defaulting to today's home feed (same behaviour and same query key when no props are passed), keeping its sentinel/infinite-scroll and skeleton pieces. Add an `emptyState` prop if the home empty text doesn't fit a tag feed. Don't copy the component
- [ ] T054 [US5] [sonnet] (wave 3) `apps/client_app/src/app/(app)/tags/[tag]/page.tsx` (+ `page.module.css`, after T053): public page; decode and normalize the param with `normalizeHashtag(decodeURIComponent(params.tag))` (Next 15: `params` is a Promise in server components, so follow how `apps/client_app/src/app/(app)/profile/` reads params); show a `#tag` header; render `<FeedList queryKey={searchKeys.tagFeed(tag)} fetchPage={(cursor, token) => getHashtagFeed(tag, { cursor }, token)} />` in a small client wrapper if the page is a server component (functions can't cross the boundary). Send the token when signed in so `likedByMe` is filled. A tag failing `HASHTAG_TAG_PATTERN_SOURCE` → `notFound()`. `generateMetadata` title `#tag`
- [ ] T057 [human] Click a `#tag` in a post card, a post detail and a comment; scroll the tag feed until it stops loading; open `/tags/{tag}` signed out; like a post on the tag feed and see it stay liked after reload

**Checkpoint**: hashtags are clickable everywhere text is rendered, and every tag has a public feed.

---

## Phase 8: Polish & cross-cutting — Batch B5 (solo)

**Purpose**: browser E2E, docs, and the perf-sized index check.

- [ ] T058 E2E fixture: add `createPublishedPost(token: string, content: string): Promise<string>` to `apps/client_app/e2e/fixtures/api.ts`, moving the create-and-publish code out of `apps/client_app/e2e/comments.spec.ts:19-34` (same error messages), and switch `comments.spec.ts` to import it
- [ ] T059 Playwright `apps/client_app/e2e/search.spec.ts`, using the fixtures in `apps/client_app/e2e/fixtures/` (`createSetupUser`, `loginInBrowser`, `run-id.ts` for unique names):
  - create a post with a unique `#tag<runId>` via `createPublishedPost`;
  - signed in: type a part of the run's username in the home search bar, press Enter, land on `/search`, see the user on People, switch to Posts and see the post, switch to Tags and see `#tag<runId> · 1 post`, click it and land on `/tags/tag<runId>` with the post visible;
  - click the hashtag inside the post card on the home feed → tag feed;
  - new context, signed out: open `/tags/tag<runId>` → the post loads; open `/search?q=x&tab=people` → the log-in prompt
- [ ] T060 [evidence] `npm run e2e` with the stack and client running (`IMPL_DIR=specs/006-search/impl scripts/impl-services.sh up auth core notif client`, then `down` when done) (all specs, not just search; `comments.spec.ts` must still pass after T058). Record the summary line
- [ ] T061 [P] [haiku] (one docs lane: T061, T062, T063) `docs/API.md`: document `GET /hashtags/search` and `GET /hashtags/:tag/posts` (params, limits, auth optional, response shapes, 400 cases), the changed `/profiles/search` semantics (infix on username or display name, ranking) and the `/posts/search` escaping. Follow the existing endpoint format in the file
- [ ] T062 [P] [haiku] `AGENTS.md`: a line on search (pg_trgm GIN indexes on usernames, display names and post content; `posts.hashtags text[]` with a GIN index; the hashtag rule lives in `@repo/contracts`; Elasticsearch deliberately not used, see `specs/006-search/plan.md`); change the CI description from a 4-entry to a 5-entry `unit-tests` matrix (add `client`); note that `client_app` now has Jest unit specs (`npm run test:cov -w client_app`) next to the Playwright E2E. Add `client_app` to the `CLAUDE.md` single-test examples only if that section lists per-app commands (keep it short)
- [ ] T063 [P] [haiku] `docs/` sweep: `grep -rni "prefix\|/posts/search\|profiles/search" docs/ apps/*/README.md` and update anything stale; add `/search` and `/tags/[tag]` to the client routes list if the client README has one
- [ ] T064 [gate] Full verification from plan.md: `npm run build -w @repo/shared -w @repo/contracts`; `(cd apps/core_microservice && npm run migration:run && npm run migration:revert && npm run migration:run)`; `(cd apps/core_microservice && npm run test:cov && npm run test:e2e)`; `npm run test:cov -w client_app`; `npm run lint:check && npm run type-check`. Between the revert and the final `migration:run`, query `pg_indexes` and record in the gate line that `IDX_user_profiles_username_lower` exists
- [ ] T066 [evidence] Perf-sized index check: `npm run db:seed -w core_microservice -- --profile perf --reset` (the perf dataset; ask before resetting if the batch plan doesn't already allow it), then `EXPLAIN (ANALYZE, BUFFERS)` the people search (3-char and 2-char query), post search, tag feed and tag prefix search SQL. Confirm the GIN indexes are used for the first three; record the tag prefix search timing as the known scan from the plan's §5 scaling note, and the 2-char people query timing (§3 known limit). Write the plans to `specs/006-search/impl/run/B5-evidence.md`
- [ ] T067 [human] Push the branch and confirm CI is green, including the new `Unit tests (client)` job
- [ ] T068 [human] Final click-through from plan.md "Manual checks": home bar, `/search` tabs, a `#tag` link and the tag feed, at desktop and phone width, signed in and signed out

**Checkpoint**: all acceptance criteria above can be ticked.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1, B1)**: no dependencies.
- **Foundational (Phase 2, B1)**: needs T001–T004 (contracts built, helper moved). Blocks every story.
- **US1 and US2 (Phases 3–4, B2)**: need Phase 2 (indexes, `escapeLikePattern` path). Independent of each other; run as parallel lanes in B2.
- **US3 (Phase 5, B3)**: needs Phase 2 (column, `extractHashtags`). Its `post.repository.spec.ts` extends the file T018 creates, so B3 runs after B2.
- **US4 (Phase 6, B4)**: People and Posts tabs need only B2. The Tags tab needs US3's API (B3).
- **US5 (Phase 7, B4 waves 2–3)**: needs US3's API, the Jest setup from T038 and `searchKeys`/`getHashtagFeed` from T040.
- **Polish (Phase 8, B5)**: needs everything.

### User story dependencies

- **US1 (P1)**: after Foundational. No story dependencies. Testable through `/profiles/search` and the existing chat and mention UI.
- **US2 (P1)**: after Foundational. No story dependencies. Testable through `/posts/search`.
- **US3 (P2)**: after Foundational. Shares `post.repository.ts`/`post.repository.spec.ts` with US2 (sequenced by batch, not a functional dependency).
- **US4 (P2)**: needs US1 and US2 for People and Posts, and US3 for Tags.
- **US5 (P3)**: needs US3 and T040.

### Within each batch

- Specs before implementation in the same task (see each task).
- Contracts → orchestrator package build → domain → repository → service/controller → client → e2e/evidence.
- Shared files have one owner per wave: `posts.module.ts` (T026 in wave 1, T030 in wave 2), `post.repository.ts` (T028 only in B3), `posts.controller.ts` (T026 only), the search e2e files (`search-people` → L-people in B2, `search-posts` → L-posts in B2, `search-hashtags` → T010 in B1 and the API lane in B3), `app-shell.tsx` (T044), `apps/client_app/package.json` (T038), `.github/workflows/ci.yml` (T039, orchestrator).

## Parallel opportunities

- **B1**: T001, T002 and T004 in parallel (contracts vs core). After the build, T005–T007 (one lane) and T008 in parallel (domain vs migration); T010 after `migration:run`.
- **B2**: two fully parallel lanes, US1 (T015, T016, T017) and US2 (T018, T019, T020). Each owns its own e2e file.
- **B3**: wave 1 runs T025, T026 and T027 in parallel. Wave 2 runs the API lane (T028–T031), T033 and T034 in parallel.
- **B4**: wave 1 runs T038+T049 (one lane) and T040 in parallel; the orchestrator does T039. Wave 2 runs T041, T042, T044, T051+T052 and T053 in parallel. Wave 3 runs T043 and T054.
- **B5**: T061–T063 (one docs lane) in parallel with T058–T059.

### Parallel example: B2

```text
Lane L-people (opus):  T015, T016, T017  | owns: profiles repository + spec, profiles controller/dto/service comments, client profile.ts comment, test/search-people.e2e-spec.ts
Lane L-posts  (opus):  T018, T019, T020  | owns: post.repository.ts + new spec, posts.controller.ts typing, post-search-response.dto.ts, test/search-posts.e2e-spec.ts
```

## Implementation strategy

### MVP first (US1 + US2)

1. B1: Setup + Foundational. The migration has run and posts carry hashtags.
2. B2: US1 and US2. People search finds display names and post search is safe and indexed. The existing UI (chat dialogs, mentions) benefits right away.
3. **Stop and validate**: T023 human check (index usage is proven on the perf dataset in T066).

### Incremental delivery

1. B3 adds the hashtag API and seeds. It can be checked with `curl` alone.
2. B4 adds the user-facing search UI, clickable hashtags and the tag feed.
3. B5 adds browser E2E, docs, perf evidence and CI.

## Notes

- Run each batch as `/clear` → `/impl-batch` (or `/impl-batch Bn`). Handoff log: `specs/006-search/impl/progress.md`.
- `/impl-batch` asks for the ticket number on the first run, because the commit prefix still contains `XX`.
- `[human]` tasks are never marked by the orchestrator.
