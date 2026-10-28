# Search: people, posts and hashtags (Postgres pg_trgm, no Elasticsearch)

## Context
The goal is a search bar at the top of the home feed (the "dashboard") and a **Search** item in the left nav, next to Home, Messages and Notifications. Today:
- `GET /profiles/search` matches only the **start** of a username (`user-profile.repository.ts:51-67`, using the B-tree index `IDX_user_profiles_username_lower`). Display names are not searched.
- `GET /posts/search` runs an unindexed `ILike('%kw%')` without escaping the keyword (`post.repository.ts:139-158`). The client never calls it.
- Hashtags don't exist anywhere.
- There is no `/search` page, and desktop has no header (`TopBar` is shown on phones only).

Decisions:
- **Scope:** people, posts and hashtags.
- **Placement:** a search bar above the feed, plus a `/search` page with tabs.
- **Engine:** Postgres `pg_trgm`, not Elasticsearch (see below).
- **Signed-out access:** post and tag search and the tag feed are public, which matches their optional-auth endpoints. People search still needs a token, so signed-out users see a log-in prompt on the People tab.
- **Tag shape:** any run of 1–50 letters, digits or `_`. Tags made only of digits (`#2024`) are allowed.

## Why not Elasticsearch
- **New infrastructure:** a JVM service needing about 1–2 GB of RAM, added to Docker Compose, `docker-compose.apps.yml`, CI, health checks, Prometheus and the alerts.
- **A sync pipeline:** an indexer that consumes the outbox, a backfill job, reindexing when the mapping changes, and handling for edits, soft deletes, archived posts and profile renames. Every one of these is a way for search to show stale or hidden content.
- **Postgres is enough at this scale:** Postgres 15 ships `pg_trgm`. GIN trigram indexes give fast, typo-tolerant `ILIKE '%q%'` and `similarity()` ranking. A text array with a GIN index covers hashtag lookups.
- **When it would pay off:** millions of documents, relevance tuning, multi-language analyzers, aggregations or faceting, or autocomplete across many entity types. The transactional outbox (`innogram.events`) means an Elasticsearch indexer can be added later without changing the public API.

## Backend (core_microservice, posts and profiles modules; follow `DDD_ARCHITECTURE_GUIDE.md`)

### 1. Migration `src/migrations/<ts>-AddSearchAndHashtags.ts`
- Run `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
- Run `ALTER TABLE posts ADD COLUMN hashtags text[] NOT NULL DEFAULT '{}'`.
- Backfill existing posts in TypeScript inside the migration:
  - Select `id, content` and extract tags with an **inlined copy** of the hashtag regex and normalization from §2 (both boundaries, NFC, lowercase, distinct, capped at 20), because migrations are frozen snapshots.
  - `UPDATE` the rows in chunks.
- Add these indexes, following the style of `1792450000000-AddPerformanceIndexes.ts` (each partial predicate mirrors its query):
  - `IDX_user_profiles_username_trgm`: GIN on `(lower(username) gin_trgm_ops)`.
  - `IDX_user_profiles_display_name_trgm`: GIN on `(lower("displayName") gin_trgm_ops)`.
  - `IDX_posts_content_trgm`: GIN on `(content gin_trgm_ops) WHERE status='published' AND "deletedAt" IS NULL`.
  - `IDX_posts_hashtags`: GIN on `(hashtags) WHERE status='published' AND "deletedAt" IS NULL`.
- Drop `IDX_user_profiles_username_lower`. The new infix people search (§3) can't use it, and nothing else filters on a `lower(username)` prefix.
- `down()`:
  - Drops the new indexes and the column.
  - Recreates `IDX_user_profiles_username_lower` exactly as before: `(lower("username") text_pattern_ops)`.
  - Keeps the extension, because dropping it can break other objects.

### 2. Hashtag rule (shared with the client)
- In `packages/contracts`, add:
  - `HASHTAG_MAX_LENGTH = 50`.
  - `HASHTAG_PATTERN_SOURCE`, the pattern source string `(?<![\p{L}\p{N}_/])#([\p{L}\p{N}_]{1,50})(?![\p{L}\p{N}_])`, used with the `gu` flags:
    - The lookbehind uses Unicode classes, not `\w`. JavaScript's `\w` only covers ASCII, even with `u`, so `café#x` would otherwise produce a tag. `/` is in the lookbehind so URL fragments like `example.com/#section` don't become tags.
    - The trailing lookahead means a run longer than 50 characters is not a tag at all. Without it, the tag would be cut off at 50 characters.
    - Export the source string, not a `RegExp`, so each caller builds its own `new RegExp(HASHTAG_PATTERN_SOURCE, 'gu')` and no `lastIndex` state is shared.
  - `normalizeHashtag()`, which strips a leading `#`, then applies `.normalize('NFC').toLowerCase()`.
  - The package has no dependencies, so both apps can use these.
- In `posts/domain/hashtags.ts`, add `extractHashtags(content): string[]` with a spec. It returns distinct, normalized tags in order of first appearance, capped at 20 per post.
- In the `Post` entity (`posts/domain/entities/post.entity.ts`):
  - Add a column `@Column('text', { array: true, default: () => "'{}'" }) hashtags`. Don't add it to `PostProps`: that type only types the `TypeormRepositoryBase` query params, not constructor input.
  - `Post.create()` fills it.
  - A new `editContent(content)` method sets the content **and** recomputes the tags.
  - `PostsService.updatePost` (`posts.service.ts:136`) calls `post.editContent()` instead of assigning `post.content` directly.

### 3. People search upgrade (`profiles`)
- Move `escapeLikePattern` out of `user-profile.repository.ts` into `src/common/` (for example `common/db/like-pattern.ts`). The profiles, posts and hashtag queries all import it from there, rather than one module importing another module's repository.
- In the repository search (`user-profile.repository.ts:51-67`):
  - Match `lower(username) LIKE '%' || lower(:q) || '%' ESCAPE '\' OR lower("displayName") LIKE '%' || lower(:q) || '%' ESCAPE '\'`, with `q` escaped.
  - Order by exact username match, then username prefix, then `greatest(similarity(...))`, then username.
  - Ranking exact and prefix matches first keeps the current callers behaving the same: the chat dialogs and mention resolution in `use-mention-profiles.ts`, which picks the exact username out of the results.
  - Replace the comment about `IDX_user_profiles_username_lower` with one about the two trigram indexes.
  - Known limit: a 2-character `q` has no complete trigram, so the GIN index can't narrow the search and Postgres effectively scans every profile. That's fine at current volume. If perf runs show a problem, raise the minimum to 3 or keep a prefix-only path for 2-character queries.
- The API shape doesn't change. Update the wording that still says "prefix" or has stale ranges:
  - `ISearchProfilesQuery` (`packages/contracts/src/profiles/requests.ts:26-33`): the doc says "username prefix" and "1-20", but the DTO allows up to 50.
  - The Swagger summary (`profiles.controller.ts:84`).
  - The `SearchProfilesQueryDto` description.
  - The `ProfilesService.searchProfiles` comment.
  - The `searchProfiles` comment in the client (`src/lib/api/profile.ts:64`).

### 4. Post search fix (`posts`)
- Rewrite `searchPublishedPosts` (`post.repository.ts:139`) with a query builder:
  - `content ILIKE '%' || :q || '%' ESCAPE '\'`, with `q` passed through `escapeLikePattern`. This is a correctness fix, so `%` and `_` in the keyword match themselves.
  - Write `status = 'published'` directly into the SQL, as `findFeedPage` does (see the comment at `post.repository.ts:54`), so the planner can match the partial `IDX_posts_content_trgm`. `findAndCount({ status })` sends the status as a bound parameter.
  - Keep the author and assets relations, `createdAt DESC, id DESC` ordering, and the `getManyAndCount` offset paging.
- Keep the `keyword` minimum at 3 characters (trigrams work best there) and keep the offset response `{items,total,page,limit}`.
- Add `IPostSearchPage` to `packages/contracts/src/posts/responses.ts`, and type `PostsController.searchPosts` as `Promise<IPostSearchPage>`.

### 5. Hashtag endpoints
These go in a new `HashtagsController` inside the posts module.
- They use `OptionalJwtAuthGuard`, like `/posts/search`, so they work signed out.
- They need full Swagger decorators, because `test/openapi.e2e-spec.ts` fails on undocumented routes.
- Both queries write `status = 'published'` directly into the SQL and filter on `"deletedAt" IS NULL`, matching the predicate of `IDX_posts_hashtags`.

**`GET /hashtags/search?q=&limit=`** returns `IHashtagResult[]`, each `{ tag, postCount }`.
- The query runs `unnest(hashtags)` over published, non-deleted posts.
- It filters with `tag LIKE :q || '%' ESCAPE '\'`, then applies `GROUP BY tag ORDER BY count DESC, tag LIMIT :limit`.
- **`q` must go through `escapeLikePattern`.** Tags can contain `_`, which is a LIKE wildcard, so without escaping `q=a_` would also match `abc`.
- After `normalizeHashtag`, `q` must be 1–50 characters of `[\p{L}\p{N}_]`.
- `limit` defaults to 10, with a maximum of `PAGE_SIZE_MAX`.

**`GET /hashtags/:tag/posts?cursor=&limit=`** returns `IFeedPage`.
- `:tag` is normalized with `normalizeHashtag` and must match `^[\p{L}\p{N}_]{1,50}$` (with the `u` flag). Otherwise the request gets a 400.
- It pages by keyset on `createdAt DESC, id DESC`, reusing `FeedCursor` and the `IsFeedCursor` validator exactly as `findFeedPage` does (ids query with a microsecond `to_char` cursor, then one hydration query).
  - The repository method mirrors `findFeedPage`'s signature: `findByHashtagPage(tag, cursor: FeedCursor | null, limit)` returning `{ posts, nextCursor: string | null }`.
  - Share only the generic parts with `findFeedPage` (page slicing with `nextCursor`, and hydrating ids in order). Its ids query (follows `UNION` + `LATERAL`) is feed-specific and stays separate.
- It filters with `hashtags @> ARRAY[$1]::text[]`.
- Results go through the existing `toResponses` path, which fills likes and comment counts. It's a private method on `PostsController`, so extract it into a small shared mapper (an injectable `PostResponseMapper` in the posts module) that both controllers use. Don't duplicate it.

**Supporting code:**
- Add `searchHashtags(prefix, limit)` and `findByHashtagPage(tag, cursor, limit)` to the port in `post-repository.port.ts`.
- DTOs go in `posts/dto/`. The `IHashtagResult` contract goes in `packages/contracts/src/posts/`.

**Scaling note:** the hashtag prefix query scans the tag arrays of all published posts, because the GIN array index can't serve a prefix match on unnested elements. That is fine at current volume. If it ever shows up in perf runs, move to a `hashtags(tag, post_count)` table maintained on publish, archive and delete.

## Client (apps/client_app)

### 6. API layer
- Add `src/lib/api/search.ts` with `searchPosts()`, `searchHashtags()`, `getHashtagFeed()` and a `searchKeys` factory. The token is optional for all three.
- Reuse `coreApi` and the existing `searchProfiles()` from `src/lib/api/profile.ts`.

### 7. Components (`src/components/search/`)
Use CSS Modules with the tokens from `globals.css`, and the existing `ui/Input`, `ui/Tabs`, `ui/EmptyState` and `ui/Skeleton`.

**`search-bar.tsx`** is a `'use client'` component: a `role="search"` form with the lucide `Search` icon.
- On the home page, submitting goes to `/search?q=…`.
- On `/search`, it is prefilled and updates `q` with `router.replace`, using the 250 ms debounce pattern from `new-direct-chat-dialog.tsx:99-102`.

**`search-results.tsx`** shows tabs **People | Posts | Tags**, with the active tab in `?tab=`.
- **People:** calls `searchProfiles` only when signed in, and renders rows linking to `/profile/{userId}`. Reuse the `chat/user-option.tsx` styling or add a small row component. Signed out, the tab shows an `EmptyState` with a log-in link.
- **Posts:** a `useInfiniteQuery` over page numbers, rendering `PostCard` with a "Load more" button. Works signed out.
- **Tags:** `#tag · N posts` rows linking to `/tags/{encodeURIComponent(tag)}`. Works signed out.
- The minimum query lengths match the backend: 2 for people, 3 for posts, 1 for tags. Below that, show a hint instead of results.

**Hashtag links in post text:**
- Extend `splitMentions` in `mentions/mention-parser.ts` to also emit `{type:'hashtag', value, tag}` parts:
  - Build the regex with `new RegExp(HASHTAG_PATTERN_SOURCE, 'gu')` from contracts.
  - `tag` is `normalizeHashtag(match)`.
- Render those parts in `mention-text.tsx` as `<Link href={`/tags/${encodeURIComponent(tag)}`}>`.
- Post cards, post details and comments all render through this, so they get hashtag links with no further changes.

### 8. Routes
- **Home (`src/app/(app)/page.tsx`):** render `<SearchBar />` above `<FeedList />` for everyone, since search works signed out. `page.tsx` stays a server component, and `SearchBar` is the client boundary.
- **Search (`src/app/(app)/search/page.tsx`):** `SearchBar` plus `SearchResults`, wrapped in `<Suspense>` because `useSearchParams` requires it. Public: signed-out users get the Posts and Tags tabs, and the People tab shows the log-in prompt (§7).
- **Tag feed (`src/app/(app)/tags/[tag]/page.tsx`):** public. It shows a `#tag` header and an infinite list, sending the token when there is one so `likedByMe` is filled. Don't copy `FeedList`: either make it accept a `queryKey` and `fetchPage`, or add a thin `TagFeedList` that reuses its sentinel and skeleton pieces.

### 9. Nav entry
- In `useNavEntries()` (`components/shell/app-shell.tsx`), add this entry right after Home in **both** the signed-in and signed-out lists:
  ```ts
  { key: 'search', label: 'Search', icon: Search, href: '/search',
    active: pathname.startsWith('/search') || pathname.startsWith('/tags') }
  ```
- Signed in, it shows up in both the sidebar and the phone `BottomBar`, which then has 6 items. Check the layout at 375 px. If it's cramped, hide Search in `BottomBar`, since the feed already has the search bar. Signed-out users have no `BottomBar`, so they see the entry only in the sidebar.

## Tests and docs
- **Core unit tests:**
  - An `extractHashtags` spec covering:
    - Unicode tags (`#café`).
    - `café#x` and `example.com/#x` are not tags.
    - A 51-character run is not a tag at all, rather than a cut-off one.
    - Digit-only tags are allowed.
    - Duplicates are removed, regardless of case and NFC form.
    - Results are capped at 20.
  - A `normalizeHashtag` spec.
  - `post.entity.spec.ts`: tags set by `create` and `editContent`.
  - `posts.service.spec.ts`: `updatePost` recomputes tags.
  - A new `hashtags.controller.spec.ts`.
  - DTO specs for the tag and `q` validation.
  - In `user-profile.repository.spec.ts`, replace the prefix-LIKE assertion at lines 41-47 with the infix `OR` and the ordering.
  - A `post.repository` spec asserting that the keyword is escaped and the status is written into the SQL.
- **Core e2e**, split into three files so the people, posts and hashtag work can each own one (`npm run test:e2e -- search` runs all three):
  - `test/search-people.e2e-spec.ts`: display-name match.
  - `test/search-posts.e2e-spec.ts`: a keyword containing `%` is escaped.
  - `test/search-hashtags.e2e-spec.ts`:
    - A tag search with `q=a_` does not match `abc`.
    - Tags are extracted on create and on edit.
    - Tag search counts only published posts.
    - Tag search and tag feed work without a token.
    - Tag feed paging, and a 400 for a bad cursor, limit or tag.
  - The existing OpenAPI e2e test checks the new routes are documented.
- **Client tests:**
  - Set up client Jest. Today `package.json` has `jest` and `ts-jest` but no transform, so a TypeScript spec won't run. In the `jest` block of `apps/client_app/package.json`:
    - Add `testEnvironment: 'node'`.
    - Add a `transform` of `'^.+\\.tsx?$'` to `['ts-jest', { tsconfig: { module: 'commonjs', jsx: 'react-jsx' } }]`.
  - Add a `test:cov` script (`jest --coverage --passWithNoTests`, no threshold, matching the existing `test` script) so the CI step stays the same.
  - Add `{ name: client, ws: client_app, dir: apps/client_app }` to the `unit-tests` matrix in `.github/workflows/ci.yml`.
  - A Jest unit spec for the extended parser (`mention-parser.spec.ts`), checking mention and hashtag parts and that URL fragments and emails stay plain text.
  - A spec for `components/search/search-limits.ts` (tab parsing and the per-tab minimum query lengths). It lands with the Jest setup, so it is the client's first unit test.
  - Add `createPublishedPost(token, content)` to `e2e/fixtures/api.ts`, moving the create-and-publish code out of `comments.spec.ts:19-34`, and switch `comments.spec.ts` to use it.
  - A Playwright spec, `e2e/search.spec.ts`:
    - Create a post with a `#tag` through `createPublishedPost`.
    - Search from the home bar, switch tabs, then click the tag and land on the tag feed.
    - Open `/tags/{tag}` signed out and check it loads.
- **Docs and seeds:**
  - Update `docs/API.md` with the new and changed endpoints.
  - In `AGENTS.md`:
    - Add a line about pg_trgm and hashtags.
    - Change the CI description from a 4-entry to a 5-entry `unit-tests` matrix.
    - Note that `client_app` now has Jest unit specs.
  - Both seeds insert posts with raw SQL, so they skip `Post.create()` and `hashtags` would stay `'{}'`. Fix both:
    - `seed/seed.ts:107`: add a few `#tags` to the dev post content, and write the `hashtags` column using `extractHashtags` (import it from `src/modules/posts/domain/hashtags`).
    - `seed/perf-profile.ts:521`: add `hashtags` to the columns. Give roughly half the posts 1–3 tags from a fixed pool of about 200, weighted so a few tags are popular, add the tags to the content as well, and compute the column with `extractHashtags`. Without this, the `EXPLAIN` check below means nothing for the hashtag queries.

## Verification
```bash
npm run build -w @repo/shared -w @repo/contracts
(cd apps/core_microservice && npm run migration:run && npm run migration:revert && npm run migration:run)
(cd apps/core_microservice && npm run test:cov && npm run test:e2e)
npm run test:cov -w client_app
npm run lint:check && npm run type-check
npm run e2e        # with stack + client running
```

Manual checks:
- Seed the perf dataset (`npm run db:seed -w core_microservice -- --profile perf --reset`).
- Run `EXPLAIN ANALYZE` on the people, post and tag-feed queries to confirm they use the GIN indexes. The tag prefix search is a known scan (see the §5 scaling note); record its timing.
- After `migration:revert`, check that `IDX_user_profiles_username_lower` exists again.
- Click through the home search bar, the `/search` tabs, a `#tag` link and the tag feed, at both desktop and phone width, signed in and signed out.
