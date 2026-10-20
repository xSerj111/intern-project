# Research: Testing Coverage & Performance Optimization

**Feature**: `004-testing-performance` | **Branch**: `feature/INO-11` | **Date**: 2026-10-20

This is the Phase 0 output. Each open question from the plan's Technical Context is settled here as a Decision / Rationale / Alternatives record. Findings about the current code cite paths so they can be re-checked. Unless noted, paths are under `apps/core_microservice/src`.

---

## 0. Findings about the current codebase

| # | Finding | Where | Consequence |
|---|---------|-------|-------------|
| F1 | The feed loads **all** of the viewer's follow rows first. It then calls `findAndCount` with `relations {author, assets.asset}`, `order {createdAt: DESC}` (no `id` tie-breaker) and `skip/take`. Because of the one-to-many join, TypeORM issues DISTINCT-ids + data + COUNT queries. Add the like and comment-count batches and a page costs about 6 queries. | `modules/posts/posts.service.ts:25`, `infrastructure/repository/post.repository.ts:34-53`, `posts.controller.ts:32-48` | Rewrite as keyset with a follows sub-select and no COUNT, with ids fetched first and then hydrated (§5, §8). |
| F2 | The global `ValidationPipe({ whitelist: true, transform: true })` has **no `forbidNonWhitelisted`**. A leftover `page` would be silently stripped, not rejected. This is the same in notifications. | `main.ts:37`; notifications `main.ts:23` | FR-010 needs explicit rejection. Declare `page` on the feed DTO and reject it with `@IsEmpty` (§4). |
| F3 | `FeedQueryDto` and `SearchQueryDto` have **no `@Max` on `limit`**. Other caps are inconsistent: messages `@Max(100)`, changes `@Max(500)`, profile search `@Max(20)`, chats `@Max(50)`, notifications `@Max(50)`, posts-by-author `@Max(50)`. Some repositories also clamp silently. | `posts/dto/feed-query.dto.ts:5`, `search-query.dto.ts:5`, `chats/dto/*query*.dto.ts`, `profiles/dto/search-profiles-query.dto.ts`, `chat.repository.ts:29`, `message.repository.ts:24-27` | One constant set in `@repo/contracts` (50, and 200 for changes), applied by every DTO. Repository clamps stay only as defense in depth below the validated maximum (§4). |
| F4 | `GET /follows/:userId/followers` and `/following` return **every row**, with no `ORDER BY` and no limit. The client dialog also loads the viewer's *entire* following list to set button state, and its "newest first" comment is wrong. | `follows/follows.controller.ts:38-47`, `follow.repository.ts:31-37`; `client_app/src/components/profile/follow-list-dialog.tsx:26,53-75` | FR-007 covers "every list endpoint", so these are paged too. This is scope the spec didn't list (§4). |
| F5 | `GET /comments/post/:postId` returns **all** comments, flat, with no paging. `findByPost` already joins `author`, and the service then fetches the same profiles again through `userDirectory.getUsers`. | `comments/comments.controller.ts:68`, `comment.repository.ts:57`, `comments.service.ts:130` | Page root comments with their replies inline, and drop the duplicate lookup (§4, §8). |
| F6 | The notifications list cursor is `occurredAt < before` while it sorts `occurredAt DESC, id DESC`. Rows that share a timestamp can be skipped at a page boundary. | `notifications_consumer_microservice/src/modules/notifications/infrastructure/notification.repository.ts:46-53` | Already capped at 50. The tie-breaker bug is **outside FR-008** (feed only). It is recorded as a follow-up and fixed only if B2 has time. |
| F7 | Indexes: `posts` has only `authorId`. `comments` has only `authorId`: no `postId`, no `parentId`. Profile search is `username ILIKE 'q%'`, which can't use the plain unique btree. Post search `content ILIKE '%kw%'` is a sequential scan. There is no `pg_trgm`. | `migrations/1782126948542-InitialCoreSchema.ts:20-38`, `user-profile.repository.ts:43-59`, `post.repository.ts:107` | Index migration (§8). Post search is not a key endpoint, so a trigram index is optional and needs measured evidence. |
| F8 | The runtime TypeORM config sets no `logging`, no `maxQueryExecutionTime` and no `extra.max` (pg default pool is 10). | `app.module.ts:26-33`, `config/app-config.service.ts:21-34` | Add a slow-query logger and a query counter (§2, §9). The pool size is exposed as a metric. |
| F9 | Public profile is `GET /profiles/by-user/:userId` (`OptionalJwtAuthGuard`). It runs 1 profile query plus 4 parallel queries: follower, following and published-post counts, and the viewer-specific `isFollowedByMe`. **There are no private profiles**: no privacy flag exists, and the INO-9 notes list it as a backend blocker. | `profile-summary/profile-summary.controller.ts:26-27`, `profile-summary.service.ts:40-52` | Cache only the viewer-independent parts. `isFollowedByMe` stays a per-request, indexed `EXISTS` (§7). FR-020 applies to assets today, and the design is ready for private profiles. |
| F10 | Core's single ioredis client sets `maxRetriesPerRequest: 1` and nothing else (offline queue on, no `commandTimeout`). `JwtAuthGuard` and `OptionalJwtAuthGuard` with a token **fail closed with 503** when Redis is down. | `common/redis/redis.module.ts:25-29`, `common/guards/jwt-auth.guard.ts:32-36` | If the cache shared this Redis, "stop the cache store" (SC-008) would 503 every authenticated request. The cache needs its own instance and client (§6). |
| F11 | `POST /assets/upload` uses `FileInterceptor('file')` with **no limits** (multer memory storage). It has only a `MaxFileSizeValidator` and **no content check**, and it writes a public object with no `storageKey`. `POST /posts` accepts `assetIds` **without checking that they exist or who owns them** (only the FK). | `assets/assets.controller.ts:25-45`, `assets.service.ts:23-51`, `posts.service.ts:80-85` | Replaced by presign + confirm. Post creation checks that assets are READY and owned (§10, §11). |
| F12 | `POST /chats/attachments` already validates by magic number with `FileTypeValidator({ fallbackToMimetype: true, overrideMimeType: true })` using the attachment allowlist regex. | `chats/attachments.controller.ts:42-64` | Reuse the same validator and allowlist on the confirm path (§11). |
| F13 | Signed GET links (15 min TTL) are re-signed on **every** response, for every attachment and chat-list preview. Signing is local HMAC with no network call. | `chats/dto/chat-response.mapper.ts:41-63`, `chats.service.ts:170-180`, `attachment-storage.port.ts:5` | Caching saves CPU and gives stable URLs (better browser caching). It is a modest latency win (§7). |
| F14 | **SeaweedFS probe** (running container, `weed version` 4.48), with a hand-signed SigV4 POST policy against `innogram-private`: within-range upload → **204**; over `content-length-range` → **400 EntityTooLarge**; key differs from the policy → **403 Policy Condition failed**; CORS preflight from `http://localhost:3000` → **200, `Access-Control-Allow-Origin: *`**. Compose uses the unpinned `latest` image. The repo has no lifecycle rules. | `docker-compose.yml:54-90`, `docker/seaweedfs/entrypoint.sh`; probe objects deleted afterwards | Presigned POST is viable and enforces FR-023 at storage. Pin `4.48`, and restrict CORS to the client origin. Expiry of unconfirmed uploads needs an app-side sweeper (§10, §11). |
| F15 | There is no scheduler (`@nestjs/schedule` is absent). The only timers are the outbox relay's unref'd `setInterval` poll and its hourly purge. | `common/messaging/outbox-relay.ts:18-24,61-73` | The pending-upload sweeper copies this pattern and claims rows with `FOR UPDATE SKIP LOCKED` (§11). |
| F16 | No service has health or metrics endpoints (`@nestjs/terminus` and `prom-client` are absent). Auth's `internal-token.middleware.ts` compares with `timingSafeEqual`, but only on the separate internal listener. Core doesn't read `INTERNAL_API_TOKEN`. Notifications reads it lazily (≥ 32 chars). | `auth_microservice/src/middleware/internal-token.middleware.ts:12-37`, `app.ts:85-103`; notifications `config/app-config.service.ts:63-72` | Move the comparison into `@repo/shared` and mount it in all three services. Validate the token at startup in core and notifications (§12). |
| F17 | Measured on 2026-10-20 with `jest --coverage` and every file under `src` counted, no thresholds: **core 61.87% lines / 59.84% branches**, **notifications 75.88 / 78.08**, **auth 55.40 / 58.21**. Auth has no `test:cov` script, and its `test:e2e` points to a `test/` directory that doesn't exist. `collectCoverageFrom` is `**/*.(t|j)s`, which includes `main.ts`, modules and migrations. | each app's `package.json` `jest` block | Thresholds of 70/60 are within reach for notifications. Core needs about +8 points of lines and auth about +15. A documented exclusion list removes bootstrap-only files and nothing else (§14). |
| F18 | Core e2e needs Postgres, Redis, RabbitMQ and SeaweedFS **plus a running auth** (`registerAndLogin` goes over HTTP). Cleanup deletes from both databases. The existing load script is plain Node (`test/load/group-fanout.ts`, p95 < 2 s, non-zero exit on failure). The seed has 8 hand-written users with timestamps relative to `Date.now()`. The client has one `data-testid`. There is no Playwright. | `test/helpers/*`, `test/load/group-fanout.ts:24`, `seed/fixtures.ts`, `client_app/src/components/chat/attachment-picker.tsx:201` | Covered by §1, §3 and §13. Test-only cross-DB cleanup is pre-existing and unchanged. |

---

## 1. Measurement and load tool

**Decision**: Use **k6**, run through a pinned `grafana/k6` Docker image (`--network host`), with one script, `apps/core_microservice/test/load/k6/key-endpoints.js`, in two modes:
- `MODE=measure`:
  - No thresholds.
  - `handleSummary()` writes the report JSON ([perf-tooling contract](./contracts/perf-tooling.md)) to `test/load/reports/<name>.json`.
  - Custom `Trend`s per endpoint for latency, plus `db_queries` read from `X-Db-Query-Count`.
- `MODE=gate`:
  - The same scenarios with k6 `thresholds` per endpoint tag (`p(95)<300`, `rate<0.01`, `abortOnFail: false`).
  - The k6 exit code becomes the command's exit code (99 on a threshold failure). The summary names the endpoint and metric.
  - `npm run perf` runs the k6 gate and then the existing `group-fanout.ts`. It fails if either fails.

The baseline must run against pre-B2 code (offset feed, multipart upload). The script picks request shapes with `FLOW=legacy|current`. The **measured unit stays the same**: one feed page of 20, and one full "post with image" round trip.

**Rationale**: k6 has per-tag thresholds and a non-zero exit built in (FR-032), and runs multi-scenario VUs cheaply. Multipart and form POSTs to S3 are easy (`http.file`). The Docker image means there is nothing to install, which matches the compose-based reference environment. The socket fan-out stays in the existing Node script, because k6 has no Socket.IO client.

**Alternatives considered**:
- *autocannon / Node script*: we would have to hand-roll scenarios, per-endpoint thresholds and percentile reporting.
- *Artillery*: heavier, and its YAML adds less than k6's JS.
- *Local k6 binary*: optional. The npm scripts use Docker so the command is the same everywhere.

**Repeatability (US1 AS3)**: `compare-reports.ts --repeatability a.json b.json` fails if any endpoint's p95 differs by more than 20%. The load profile is fixed: 20 VUs constant, 30 s ramp, 2 min hold, `--no-thinktime`. A 15 s warm-up is excluded from the stats. Core runs as `node dist/main`, not watch mode.

## 2. Queries-per-request counting

**Decision**:
- `common/db/query-context.ts`: an `AsyncLocalStorage<{ queries: number }>` started by a Nest middleware for every HTTP request.
- `TypeOrmPerfLogger implements Logger`: `logQuery()` increments the counter (prints nothing) and `logQuerySlow()` logs per §9.
- Config: `logging: ['query', 'error']`, `logger: new TypeOrmPerfLogger(...)`.
- When `PERF_INSTRUMENTATION=true`, an interceptor sets the response header `X-Db-Query-Count`. The same value also feeds the `db_queries_per_request` histogram (B6).
- Core refuses to boot with `PERF_INSTRUMENTATION=true` and `NODE_ENV=production`.

**Rationale**: The count is attributed exactly to the request, including the parallel `Promise.all` queries, because ALS follows async context. It needs no DB-side setup and no `pg_stat_statements` reset between endpoints. The header lets k6 record it per request. It is not optimization code, so it can merge in B1 before the baseline.

**Alternatives**:
- *`pg_stat_statements` deltas*: aggregate per query, not per request, and need superuser plus a restart.
- *Count in tests only*: doesn't produce numbers for the load report (FR-002).

Transactions: `BEGIN`/`COMMIT` pass through `logQuery`, so they are counted. That matches the real round-trips.

## 3. Perf seed profile

**Decision**:
- Extend both existing seeds with `--profile perf`. `npm run db:seed -w auth_microservice -- --profile perf --reset`, then the same for core.
- Use a deterministic PRNG (mulberry32, seed `20261020` fixed in code) and a fixed base date (2026-01-01T00:00:00Z) instead of `Date.now()`.
- Ids come from `seedId(kind, n)`, deterministic UUIDs shared by the auth and core seeds. That is how auth users and core profiles line up without either seed touching the other's DB.
- Volumes (spec Assumptions):

| Kind | Count | Distribution |
|------|-------|--------------|
| users | 1,000 (`perf0001@innogram.dev` …, one shared password) | — |
| follows | 10,000 | 10 per user on average, skewed so ~20 "popular" users have 150+ followers |
| posts | 20,000 | 20 per user on average, skewed; 30% with 1–3 images |
| comments | 50,000 | 30% replies |
| chats | 200 | 150 direct, 50 groups of 3–20; 20 messages each |
| likes | ~40,000 | — |

- Images point at 10 small sample objects that the seed uploads once to the public bucket.
- Inserts use multi-row `INSERT … VALUES` in chunks of 1,000 inside one transaction per table. Auth hashes the shared password **once**.
- The VU pool is the first 200 perf users. The k6 `setup()` logs each in through auth and hands out tokens round-robin.

**Rationale**: Reproducible (FR-004) and large enough that the missing indexes and the COUNT/IN-list costs show up. Generating everything takes seconds, not minutes.

**Alternatives**:
- *Generating through the public API*: slow, and it would also fire outbox and notification side effects.
- *A SQL dump fixture*: opaque, drifts with migrations.

## 4. Page-size caps and the `page` rejection

**Decision**:
- `@repo/contracts/common/pagination.ts` exports `PAGE_SIZE_MAX = 50` and `CHANGES_PAGE_SIZE_MAX = 200`.
- Every list query DTO uses `@Type(() => Number) @IsInt() @Min(1) @Max(<const>)`. Non-numeric values become `NaN`, which fails `IsInt` → 400. Default sizes are unchanged.
- Per-endpoint table: [contracts/pagination-http.md](./contracts/pagination-http.md). The changes:
  - feed and post search 50 (were unbounded)
  - messages 100 → 50 (the client sends no `limit`, default 50)
  - changes 500 → 200 (the client uses 200)
  - profile search 20 → 50 (one rule; clients send ≤ 20)
- Feed `page` rejection: `FeedQueryDto` declares `page?: unknown` with `@IsEmpty({ message: 'page is not supported; use cursor' })`. Because the property is declared, `whitelist` keeps it and the validator rejects any value.
- Newly bounded lists (F4, F5). They keep offset paging, per the clarification:
  - **Followers/following**: `page` (default 1) and `limit` (default 50, max 50). Ordered `createdAt DESC, id DESC`. The response becomes `IOffsetPage<IFollowListItem>` `{ items, page, limit, hasMore }`, and items gain `isFollowedByMe` (one batched `EXISTS … IN` query for the viewer). The client dialog no longer loads the viewer's full following list.
  - **Comments**: `page`/`limit` (default 20, max 50) over **root** comments, newest first. The replies of the returned roots come inline in the same response. Reply volume is bounded by the threads on the page; the seed averages under 1 reply per root. The response is `IOffsetPage<ICommentResponse>`, and the client gets a "Load more comments" control.
- `hasMore` comes from fetching `limit + 1`, so there is no `COUNT`.

**Rationale**:
- One constant per rule means SC-007 ("100,000 → 400; exactly the max → 200") is a single table-driven e2e test.
- `@IsEmpty` is the narrowest way to reject `page` without turning on `forbidNonWhitelisted` globally. Doing that would turn every stray query or body field in all clients into a 400, which is risky and outside scope.

**Alternatives**:
- *Global `forbidNonWhitelisted`*: broad blast radius (F2).
- *Silent clamping*: forbidden by FR-007.
- *Cursor paging for comments and follows*: the clarification keeps non-feed lists on offset.
- *Paging replies separately*: needs a new UI pattern. Deferred.

## 5. Feed cursor

**Decision**:
- **Order**: `createdAt DESC, id DESC`.
- **Cursor**: base64url of `{"v":1,"t":"<createdAt with µs>","id":"<uuid>"}`.
- **Query**: ids first (index-only on the partial feed index, §8), then hydration by id:

```sql
SELECT p.id, to_char(p."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t
FROM posts p
WHERE p.status = 'published' AND p."deletedAt" IS NULL
  AND (p."authorId" = :me OR p."authorId" IN (SELECT f."followingId" FROM follows f WHERE f."followerId" = :me AND f."deletedAt" IS NULL))
  AND (:t IS NULL OR (p."createdAt", p.id) < (:t::timestamptz, :id::uuid))
ORDER BY p."createdAt" DESC, p.id DESC
LIMIT :limit + 1
```

The exact column names and the status enum literal are confirmed against the entity during B2.

- `nextCursor` is built from the last returned row's raw `t` text, **not** from a JS `Date`. JS dates truncate to milliseconds, so a cursor made from them would skip rows that share a millisecond.
- Malformed input (bad base64 or JSON, wrong `v`, invalid timestamp or uuid) → 400 through a custom `@IsFeedCursor()` validator.
- A well-formed but tampered or deleted position simply continues after that `(t, id)`, as the spec allows: "continues from the nearest valid position". The cursor reveals nothing secret, so it isn't signed.

**Rationale**:
- Keyset paging is the only scheme that guarantees no duplicates or gaps under concurrent inserts (FR-008, SC-007).
- The row comparison is index-friendly.
- Removing the follows pre-fetch and the COUNT removes 2 queries and the IN-list that grew with follow count.

**Alternatives**:
- *Offset plus a snapshot timestamp*: still skips on deletes.
- *Cursor with only `createdAt`*: ties break it.
- *HMAC-signed cursor*: it protects nothing here, and it's one more secret to manage.

## 6. Cache store placement

**Decision**:
- Add a separate `redis-cache` compose service: `redis:7-alpine`, `--save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru`, host port 6380. Core env: `CACHE_REDIS_HOST`, `CACHE_REDIS_PORT`.
- Core uses a separate ioredis client, `CACHE_REDIS_CLIENT`, configured with:
  - `commandTimeout: 50`
  - `connectTimeout: 500`
  - `enableOfflineQueue: false`
  - `maxRetriesPerRequest: 0`
  - `retryStrategy` backoff capped at 2 s

**Rationale**:
- F10: the session Redis is security-critical and fails closed. Putting cache data in it would make SC-008's "stop the cache store, everything still succeeds" impossible for any authenticated endpoint. It would also put eviction pressure on blacklist keys, which must use `noeviction`.
- With no persistence, a restarted cache comes back empty. That trivially satisfies US5 AS4 for restart-type outages.
- No offline queue plus a 50 ms timeout makes a slow or dead cache cost at most about 50 ms before the DB fallback (edge case "reachable but slow").

**Alternatives**:
- *Same Redis, different DB index*: same process, same outage. Rejected.
- *In-process LRU*: simple and fast, but it isn't the "cache store" the spec means, and invalidation needs a pub/sub layer once there are several instances.

## 7. Cache design

**Decision**: cache-aside behind `ICacheStore` (`get<T>`, `set<T>(key, value, ttlSec)`, `del(...keys)`). Every call is wrapped: on error or timeout it logs at `warn` (rate-limited), records `result="error"`, and returns *miss*. Keys are versioned with a `cache:v1:` prefix.

| Resource label | Key | Value | TTL | Invalidated by (after commit) |
|----------------|-----|-------|-----|-------------------------------|
| `profile` | `cache:v1:profile:{authUserId}` | public profile fields (no viewer data) | 60 s | profile edit, avatar change, profile creation |
| `follow_counts` | `cache:v1:counts:{authUserId}` | `{followerCount, followingCount, postCount}` | 60 s | follow/unfollow (**both** users), post publish/delete by that author |
| `signed_url` | `cache:v1:surl:{assetId}:{dispositionHash}` | `{url, expiresAt}` | `floor(linkTtl/2)` = 450 s | message delete (asset soft-delete), asset deletion |

- **Freshness**: invalidation deletes the key *after* the DB transaction commits. With sequential write → read, the next read is always fresh (SC-008).
- **Race** (edge case): a read that started before the write can repopulate the old value after the `del`. That staleness is bounded by the 60 s TTL. The spec accepts this, so there is no locking or versioning machinery.
- **Cache down during a write**: if the `del` fails, the entry may survive until its TTL. This is bounded and logged.
- **Signed-link safety margin (US5 AS5)**: links are cached for at most half their validity. On read, an entry is served only if `expiresAt - now ≥ linkTtl/2`; otherwise it is re-signed. A client therefore always receives a link valid for at least 7.5 min.
- **Visibility (FR-020)**:
  - Authorization runs *before* the cache: the participant check for attachments, and the existing route guards for profiles.
  - Cached values never contain viewer-specific data.
  - `isFollowedByMe` is computed per request.
  - There are no private profiles today (F9). If a privacy flag is added later, the profile entry will carry it and the access check will run on the cached value. The key layout doesn't need to change.
- **Metrics**: `cache_requests_total{resource, result="hit|miss|error"}` (FR-019). The hit ratio for SC-009 = hit / (hit + miss) for `resource="profile"`, scraped before and after the gate run.

**Alternatives**:
- *Write-through*: couples writes to cache availability.
- *Tag-based invalidation sets*: unnecessary for single-key resources.
- *Caching the whole feed*: viewer-specific, invalidation fans out, poor hit rate.

## 8. Query optimization and indexes

**Decision**: one migration, `AddPerformanceIndexes`. Final names and column quoting follow the existing migrations.

| Index | Serves |
|-------|--------|
| `posts (authorId, createdAt DESC, id DESC) WHERE status='published' AND deletedAt IS NULL` | feed keyset, posts by author, published-post counts |
| `comments (postId, createdAt DESC, id DESC) WHERE parentId IS NULL AND deletedAt IS NULL` | root comments page |
| `comments (parentId) WHERE deletedAt IS NULL` | replies of a page of roots; cascade soft delete |
| `follows (followingId, createdAt DESC, id DESC)` / `follows (followerId, createdAt DESC, id DESC)` | ordered follow lists (replace the single-column ones if the planner prefers them) |
| `user_profiles (lower(username) text_pattern_ops)` | profile search, rewritten as `lower(username) LIKE lower(:q) || '%'` |

Query rewrites:
- **Feed**: §5. That makes 4 queries per page: ids, hydrate, like stats, comment counts. It was about 6, and the IN-list grew with follows.
- **Comments**: drop the duplicate `userDirectory.getUsers` call, because `author` is already joined. Roots plus replies come from two queries.
- **Profile summary**: the counts come from cache; on a miss there are 3 count queries.
- **Post creation**: keep the reload, but the two enrichment queries for a new post are skipped (counts are 0, `likedByMe` is false).
- **Chat list**: the correlated unread `COUNT` per participant row is measured in B1. It is rewritten (`lastSeq - lastReadSeq`, adjusted for hidden rows) **only if** the baseline flags it. The existing indexes `(chatId, seq)` already make it an index range scan.
- No N+1 exists today (all enrichment is batched). FR-013 is locked in by an e2e assertion: `X-Db-Query-Count` is equal for `limit=5` and `limit=50`.

**Evidence (FR-012 / US4 AS2)**: B3 appends an addendum to this file with `EXPLAIN (ANALYZE, BUFFERS)` before and after each changed query on the perf seed.

**Alternatives**:
- *`pg_trgm` for profile search*: needed only for infix search. Prefix matching is the existing behaviour, so `text_pattern_ops` is enough.
- *Denormalized counter columns* (followers, likes): faster reads, but every write path changes. Caching covers the hot read.

## 9. Slow-query logging

**Decision**:
- `maxQueryExecutionTime = SLOW_QUERY_MS` (default 200).
- `TypeOrmPerfLogger.logQuerySlow(time, query)` logs `warn 'Slow query'` with `{ durationMs, queryId, query }`:
  - `queryId` = first 12 hex characters of `sha1(normalized query)`.
  - `query` is the parameterized SQL text with `$1…` placeholders, truncated to 2 KB.
- The `parameters` argument is **never** read. A unit test asserts that a sentinel email passed as a parameter doesn't appear in the log output (SC-012).
- **Caveat**: SQL that TypeORM builds with inline literals would leak values. The codebase uses parameters everywhere, and the B3 review checks that `query()` calls use parameters.

**Alternatives**:
- *Postgres `log_min_duration_statement`*: logs bound parameters in some modes, the log lives in the container, and it can't be correlated per service.

## 10. Uploads: direct to storage

**Decision**: presigned **POST** (SigV4 policy), generated with `@aws-sdk/s3-presigned-post` against the `presignClient` (`S3_PUBLIC_ENDPOINT`).
- `POST /uploads` body: `{ purpose, contentType, size, fileName? }`.
  - The domain validates `purpose ∈ {post-image, avatar, chat-attachment}`, `1 ≤ size ≤ 10 MB`, and `contentType` in that purpose's allowlist. The declared type is only a hint; the real check runs at confirm.
  - It creates `Asset.createPending(...)` (status `PENDING`, `expiresAt = now + 5 min`).
  - Key:
    - private bucket `pending/{uploaderId}/{assetId}` for public purposes
    - `chat/{uploaderId}/{assetId}` for chat attachments
  - It returns `{ uploadId, url, fields, maxBytes, expiresAt }`.
- Policy conditions: `{bucket}`, `{key: <exact>}`, `["content-length-range", 1, 10485760]`, `{"Content-Type": <declared>}`, and an expiry of 5 min (FR-021, FR-023). F14 confirms SeaweedFS 4.48 enforces the range and the key.
- Pending public images are uploaded **into the private bucket**. The public bucket allows anonymous reads, so an unvalidated object there would be served from our storage origin, which could host arbitrary HTML/JS.
- **CORS**: start SeaweedFS with `-s3.allowedOrigins=${CLIENT_URL}` (the default today is `*`, F14). Pin the image to `chrislusf/seaweedfs:4.48`.
- The client posts with `XMLHttpRequest` to keep the existing upload progress UI. Storage errors (e.g. `EntityTooLarge`) are mapped to "File is larger than 10 MB".

**Rationale**: POST policies are the only S3 presign that enforces a size range by itself (FR-023). Presigned PUT can only pin an exact `Content-Length`.

**Alternatives**:
- *Presigned PUT with a signed `Content-Length`*: works as a fallback if a future SeaweedFS drops POST policy, because the declared size is pinned exactly. Kept as plan B behind the same port method.
- *Streaming through core with busboy*: still puts bytes through core. Rejected by the clarification.

## 11. Confirm, content validation, promotion, cleanup

**Decision**: `POST /uploads/:uploadId/confirm`, all in `UploadsService`, with the rules on `Asset`:

1. Load the asset. Not found, or `uploaderId ≠ sub` → 404 (`EntityNotFoundError`, no ownership leak).
2. If already `READY` → return the same response (idempotent; edge case "confirm twice").
3. `asset.assertConfirmableBy(sub, now)`: if expired → `UploadExpiredError` (400).
4. `storage.head(key)`: missing → `UploadNotReadyError` (400); `ContentLength > 10 MB` → delete, `UploadTooLargeError`.
5. `storage.readHead(key, 4100)` (ranged GET, `bytes=0-4099`).
6. `IContentSniffer.detect(head, declared, purpose)`. The adapter reuses Nest's `FileTypeValidator` on a synthetic `{ buffer: head, mimetype: declared, size }`, with the same allowlist and `fallbackToMimetype` behaviour as F12. Text attachment types (plain, csv) must also be valid UTF-8 with no NUL bytes.
   - Images: JPEG, PNG, WebP, GIF only. SVG is never allowed.
   - Not allowed → delete the object, `asset.reject()` (soft delete), `UploadContentRejectedError` (400).
7. **Promotion**, for public purposes: `CopyObject` from private `pending/…` to public `{assetId}{ext}`, where `ext` comes from the *detected* type. Then delete the pending object. The copy happens inside storage, so no bytes pass through core.
8. `asset.confirm({ mimeType: detected, size: actual, bucket, key, url })` → `READY`, then save. If the save fails, delete the promoted object.

- **Consumers**:
  - `POST /posts` requires each `assetId` to be `READY`, owned by the caller, and of purpose `post-image` (`asset.assertAttachableTo('post', sub)`). This also fixes F11.
  - The avatar path requires `avatar` or `post-image`.
  - The message domain check adds `READY`.
- **Sweeper**: `PendingUploadSweeper`. Every 15 min, an unref'd `setInterval` (F15 pattern) claims up to 500 rows with `status='PENDING' AND expiresAt < now() - interval '1 hour'` using `FOR UPDATE SKIP LOCKED`, deletes each object (missing is OK), then hard-deletes the rows. The worst case is 5 min + 1 h + 15 min, well inside 24 h (FR-025). The cutoff is configurable for tests (`UPLOAD_SWEEP_GRACE_SEC`).
- **Interrupted uploads** leave either no object or a partial one that S3 never commits. Confirm then fails at the `head` step, and the sweeper removes the row.

**Rationale**: Reading only 4 KB (FR-022) and copying inside storage keep core's memory flat (SC-010). Reusing `FileTypeValidator` keeps one allowlist implementation.

**Alternatives**:
- *Storage lifecycle rules*: SeaweedFS lifecycle support is limited (filer TTL) and isn't in the repo. The sweeper is portable and testable.
- *Validating before upload in the browser only*: not a security control.

## 12. Health and metrics

**Decision**:
- **Shared (`@repo/shared/observability`)**:
  - `createMetricsRegistry(service)`: a prom-client `Registry` with `collectDefaultMetrics` (gives `process_resident_memory_bytes` for SC-010), plus:
    - `http_request_duration_seconds{method, route, status_class}`: histogram, buckets 5 ms–5 s.
    - `http_request_errors_total{method, route, status_class}`: counter for 4xx/5xx.
    - `db_pool_connections{state="total|idle|waiting"}`: gauge, collected on scrape from the pg `Pool` (`dataSource.driver.master` for TypeORM; the same for auth).
    - Core only: `cache_requests_total{resource, result}` and `db_queries_per_request{route}`.
  - `httpMetricsMiddleware(registry)`: Express-compatible, so it works in Nest (`app.use`) and auth.
    - `route` = `req.baseUrl + req.route.path` on finish, so a template like `/posts/:id` keeps cardinality low.
    - `unmatched` if there is no route.
    - `/health*` and `/metrics` are excluded.
  - `runHealthChecks(checks, { timeoutMs: 1000 })`: runs the checks in parallel, each with `Promise.race` against a timeout. A timeout counts as `unhealthy` for that check.
    - Rollup: any *critical* check down → `unhealthy`; any non-critical check down → `degraded`; otherwise `healthy`. The whole run is bounded at about 1 s, under the 2 s target (FR-027).
  - `isValidInternalToken(header, expected)`: `timingSafeEqual` on SHA-256 digests (constant-length), and `requireInternalToken` middleware. Auth's existing internal listener switches to the shared function.
- **Endpoints per service** (main port), contract in [observability-http.md](./contracts/observability-http.md):
  - `GET /health` → `{status}`; 200 for healthy or degraded, 503 for unhealthy.
  - `GET /health/details` (token) → full report.
  - `GET /metrics` (token) → Prometheus text.
  - A wrong or missing token → 401 `{statusCode: 401, message: 'Unauthorized'}`, with no details (FR-029).
- **Checks**:
  - **core**: Postgres `SELECT 1`, critical. Session Redis `PING`, critical, because auth fails closed without it. Cache Redis `PING`, non-critical. RabbitMQ connection state, non-critical, because the outbox buffers. Object storage `HeadBucket`, non-critical.
  - **notifications**: Postgres, critical. Session Redis, critical. RabbitMQ, critical, because consuming is the service's purpose. SMTP `verify()`, non-critical.
  - **auth**: Postgres, critical. Redis, critical.
- **Fail-fast**: core and notifications read `INTERNAL_API_TOKEN` (≥ 32 chars) during bootstrap and exit if it is invalid. Auth already does this.
- **Monitoring profile** (FR-030): `docker compose --profile monitoring up` starts Prometheus (scrapes the three services through `host.docker.internal`) and Grafana with one provisioned dashboard showing p95 by route, error rate, cache hit ratio, pool usage and RSS.
  - The token reaches Prometheus through `http_headers: { X-Internal-Token: { files: [/run/secrets/internal_token] } }`. The entrypoint writes that file from env.
  - Nothing else depends on this profile.

**Rationale**:
- One implementation in three services.
- A plain runner gives the three-state status the spec needs. `@nestjs/terminus` is up/down only, and it doesn't fit Express auth.
- Route-template labels keep cardinality bounded.

**Alternatives**:
- *Terminus plus `@willsoto/nestjs-prometheus`*: Nest-only, so auth would need a second implementation.
- *A separate metrics port*: rejected by the clarification.
- *OpenTelemetry*: heavier than the requirement.

## 13. Browser E2E

**Decision**:
- `@playwright/test`, pinned, in `apps/client_app`, with script `test:e2e`. The root has `npm run e2e`.
- `playwright.config.ts`:
  - `baseURL` from `CLIENT_URL` (default `http://localhost:3000`)
  - Chromium project only
  - `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `video: 'off'`
  - `retries: 0` locally
  - `workers: 2`
  - `outputDir: e2e/.artifacts` (gitignored)
  - No `webServer`: the tests run against the already running stack (FR-034).
- **Unique data**: `runId = Date.now().toString(36) + random`, so users are `e2e_${runId}_${n}`. Setup users are registered through the auth API (fast). Flow 1 registers through the UI because that *is* the flow.
- **Flows**:
  1. Signup → login → feed renders with no console errors.
  2. Create a post with a fixture PNG → it appears in the feed and `img` has `naturalWidth > 0`. This goes through the new upload flow.
  3. Comment, then reply → the reply is nested under the comment.
  4. Two browser contexts, a direct chat: A sends, and B sees it without reload.
- **Selectors**: role/label first, with `data-testid` added where roles are ambiguous (feed item, comment item, reply container, message bubble).
- **CI**: optional. Not part of this feature's gates (spec Assumptions).
- SC-005 is verified with `--repeat-each=3` in one command.

## 14. Coverage and CI

**Decision**:
- **Jest config** in each service's `package.json`:
  - `coverageThreshold: { global: { lines: 70, branches: 60 } }`
  - `coverageReporters: ['text-summary', 'lcov', 'json-summary']`
  - `collectCoverageFrom` excludes **only** bootstrap and generated files: `main.ts`, `**/*.module.ts`, `migrations/**`, `**/index.ts`, `**/*.d.ts`.
  - Domain entities, services, adapters, controllers and DTOs stay counted.
  - Auth gains `test:cov`, and its dead `test:e2e` script is removed.
- **Targets**: notifications already passes. Core needs about +8 lines. Auth needs about +15. Priority order for new specs:
  - auth: `auth.service` (refresh, logout, Google), the JWT service, `users.service`, middleware (`requireAuth`, `internal-token`, error handler), and routes through supertest on `createApp()` with mocked ports
  - core: the new code from B2–B6, plus gaps in the `follows`, `comments` and `profile-summary` services
- **CI** (`ci-pipepline.yml`): the `unit-tests` job becomes a matrix over `[core_microservice, auth_microservice, notifications_consumer_microservice]`, with `fail-fast: false`. Steps:
  1. `npm ci`
  2. `npm run build -w @repo/contracts -w @repo/shared`
  3. `npm run test:cov -w ${{ matrix.app }}`
  4. `actions/upload-artifact@v4` `coverage-${{ matrix.app }}` with `if: always()`
- A failed threshold prints Jest's `coverage threshold for lines (70%) not met`. The matrix job name shows the service (US10 AS2).

**Alternatives**:
- *Codecov*: an external service, not required.
- *Per-directory thresholds*: more policy than the spec asks for.

---

## Open items carried to tasks (none block planning)

- B3 adds the `EXPLAIN` addendum (§8). The chat-list unread rewrite is conditional on the baseline.
- F6 (notifications cursor tie-breaker) is a follow-up, or a B2 extra if time allows.
- The exact pinned versions (`grafana/k6`, `@playwright/test`, `prom/prometheus`, `grafana/grafana`, `@aws-sdk/s3-presigned-post` matching the installed client-s3) are recorded at install time.

## §8 Addendum: baseline findings

Captured on 2026-10-20 on pre-B2 code (`FLOW=legacy`, rev `51d384d-dirty`, i.e. B1 tooling uncommitted on top of 51d384d). Environment: 11th Gen Intel i5-1135G7 (8 cores), 23 GB RAM, Linux 7.0.0-38-generic, Node v24.16.0, local docker infra (Postgres, Redis, RabbitMQ, SeaweedFS 4.48), core started as `PERF_INSTRUMENTATION=true node dist/main`. Seed: `perf` v1 (1000 users, 256 chats, 4545 messages). Load: 20 VUs, 30 s ramp, 120 s hold, 15 s warm-up. Committed report: `apps/core_microservice/test/load/reports/baseline.json`.

| Endpoint | p50 ms | p95 ms | queries/req avg | queries/req max |
|---|---|---|---|---|
| `GET /posts/feed?page=1&limit=20` | 64.22 | 79.34 | 6 | 6 |
| `GET /profiles/by-user/:userId` | 26.73 | 37.02 | 4.98 | 5 |
| `GET /comments/post/:postId` | 29.98 | 43.50 | 2.05 | 3 |
| `GET /profiles/search` | 16.19 | 24.44 | 1 | 1 |
| `GET /chats?limit=20` | 25.38 | 64.64 | 3 | 5 |
| `POST /assets/upload` + `POST /posts` | 99 | 123 | 11 | 11 |

All error rates were 0%.

Repeatability (`npm run perf:compare -- --repeatability baseline baseline-2`, limit ±20% p95, exit 0):

| Endpoint | baseline p95 | baseline-2 p95 | delta |
|---|---|---|---|
| feed | 79.3 | 79.1 | -0.3% |
| profile | 37 | 36.2 | -2.4% |
| comments | 43.5 | 42.6 | -2.2% |
| profile_search | 24.4 | 23.9 | -2.1% |
| chat_list | 64.6 | 63.7 | -1.4% |
| post_create_image | 123 | 117 | -4.9% |

**Chat-list unread `COUNT`: not flagged by baseline, unchanged (T066 is skipped).** The correlated unread `COUNT` is part of the single membership query (`chat.repository.ts`, "per-viewer unread counts"). The 3 queries/request average comes from the membership query (with the COUNT), the chats-with-participants query and the latest-message query (plus conditional attachment and counterpart queries, max 5), not from a per-row count query. `EXPLAIN (ANALYZE, BUFFERS)` for the busiest perf user (7 chats) gives an execution time of 0.72 ms. The subplan is a `Bitmap Index Scan` on `IDX_messages_chatId_seq` with about 0.01 ms per participant row, and the `(chatId, seq)` index makes it a range scan, as §8 expected. The seed has at most 20 messages per chat, so this says nothing about very long chats. The chat list's p95 (64.6 ms) is well above its p50 (25.4 ms) and is not explained by the COUNT.
