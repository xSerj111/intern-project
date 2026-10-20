---

description: "Task list for Testing Coverage & Performance Optimization (INO-11)"
---

# Tasks: Testing Coverage & Performance Optimization

**Input**: Design documents from `/specs/004-testing-performance/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/README.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The spec makes tests part of the deliverable: integration suites for every changed behaviour (US2, FR-006), browser E2E (US9), load gates (US8) and coverage thresholds (US10). Unit specs (`*.spec.ts`, `rootDir: src`) go next to the code they verify. Core e2e suites (`apps/core_microservice/test/*.e2e-spec.ts`) run against `npm run docker:up` plus a running auth service.

**Organization**: Tasks are grouped by user story. Phases follow the spec's mandatory batch order (FR-041), not the P1/P2 labels: baseline → pagination → queries → caching → uploads → monitoring → perf gate → browser E2E → coverage/CI. US2 (integration suites) is cross-cutting: its harness is a phase of its own, and each new suite is listed in the phase of the behaviour it tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story the task belongs to (US1–US10)
- Paths are relative to the repo root

## Path Conventions

| Short name | Path |
|------------|------|
| core | `apps/core_microservice/src/` (e2e: `apps/core_microservice/test/`) |
| auth | `apps/auth_microservice/src/` |
| notif | `apps/notifications_consumer_microservice/src/` |
| client | `apps/client_app/src/` |
| contracts | `packages/contracts/src/` |
| shared | `packages/shared/src/` |

Task descriptions always spell out the full path. The table is only a reading aid.

## Batch mapping (plan.md "Delivery Order")

| Batch | Phases | Tasks |
|-------|--------|-------|
| B1 | Setup, Foundational, US1, US2 harness | T001–T029 |
| B2 | US3 pagination | T030–T057 |
| B3 | US4 queries | T058–T068 |
| B4 | US5 caching | T069–T080 |
| B5 | US6 uploads | T081–T104 |
| B6 | US7 health & metrics | T105–T126 |
| B7 | US8 perf gate | T127–T136 |
| B8 | US9 browser E2E | T137–T147 |
| B9 | US10 coverage & CI | T148–T160 |
| — | Polish | T161–T167 |

## Ground rules for every task

- Read `DDD_ARCHITECTURE_GUIDE.md` before touching core. `modules/profiles` is the reference layout.
- Business rules live on entity methods and throw `DomainError` subclasses (`@repo/shared`). `DomainExceptionFilter` maps unknown subclasses to 400 and `EntityNotFoundError` to 404. Services orchestrate, controllers only map HTTP. No `HttpException` in domain code.
- Ports are interfaces in `domain/interfaces/` (or `common/<area>/*.port.ts` for cross-cutting ports), bound to adapters with `Symbol` DI tokens.
- Request DTOs `implements` the matching `@repo/contracts` interface and add `class-validator` decorators. The client imports `@repo/contracts` only, never `@repo/shared`.
- Page sizes are **rejected, never clamped** (FR-007). Cache failures **never** become request errors (FR-018). Upload bytes **never** pass through core (FR-021). Slow-query logs **never** contain parameter values (SC-012).
- Schema changes are TypeORM migrations in `apps/core_microservice/src/migrations/` (`synchronize: false`).
- After changing `packages/shared` or `packages/contracts`, run `npm run build -w @repo/contracts -w @repo/shared` before building or testing an app.
- A batch is done only when every existing unit and e2e suite still passes (FR-041).
- Prettier: `singleQuote: true`, `trailingComma: "all"`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Reproducible local infrastructure and environment variables used by every later batch.

- [X] T001 Pin the SeaweedFS image to `chrislusf/seaweedfs:4.48` (currently `latest`, research F14) in `docker-compose.yml`, then run `npm run docker:up` and confirm `docker compose exec seaweedfs weed version` prints 4.48
- [X] T002 [P] Add the new variables to `.env.example` with comments, defaults per `contracts/observability-http.md` "New environment variables": `INTERNAL_API_TOKEN` (now also read by core; comment "≥ 32 chars, identical across core, auth and notifications"), `CACHE_REDIS_HOST=localhost`, `CACHE_REDIS_PORT=6380`, `SLOW_QUERY_MS=200`, `PERF_INSTRUMENTATION=false` (comment "measure runs only; core refuses to start with it in production"), `UPLOAD_LINK_TTL_SEC=300`, `UPLOAD_SWEEP_GRACE_SEC=3600`, `UPLOAD_SWEEP_INTERVAL_SEC=900`
- [X] T003 [P] Add ignore rules to the root `.gitignore`: `apps/client_app/e2e/.artifacts/`, `apps/client_app/playwright-report/`, `apps/client_app/test-results/`, and `apps/core_microservice/test/load/reports/*.json` with exceptions `!apps/core_microservice/test/load/reports/baseline.json` and `!apps/core_microservice/test/load/reports/final.json`

**Checkpoint**: `npm run docker:up` starts the stack with SeaweedFS 4.48; `.env.example` documents every new variable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config getters and the shared metrics registry that US1, US5, US6 and US7 all build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add typed getters to `apps/core_microservice/src/config/app-config.service.ts`: `perfInstrumentation` (boolean, `PERF_INSTRUMENTATION === 'true'`, default `false`), `slowQueryMs` (int, default `200`), `cacheRedis` (`{ host: CACHE_REDIS_HOST ?? 'localhost', port: CACHE_REDIS_PORT ?? 6380 }`), `uploads` (`{ linkTtlSec: 300, sweepGraceSec: 3600, sweepIntervalSec: 900 }` from `UPLOAD_LINK_TTL_SEC` / `UPLOAD_SWEEP_GRACE_SEC` / `UPLOAD_SWEEP_INTERVAL_SEC`), and `internalApiToken` (raw string or `undefined`; validation is added in T118). Cover parsing and defaults in `apps/core_microservice/src/config/app-config.service.spec.ts` (create if missing)
- [X] T005 [P] Add `prom-client@^15` and `@repo/contracts` (workspace `*`) to dependencies in `packages/shared/package.json`, run `npm install` from the repo root
- [X] T005a Make `@repo/shared` testable: add `"test": "jest --passWithNoTests"` and `"test:cov": "jest --coverage --passWithNoTests"` to `packages/shared/package.json` and a `jest` block (`rootDir: "src"`, `testRegex: ".*\\.spec\\.ts$"`, `transform` via `ts-jest`, `testEnvironment: "node"`, `collectCoverageFrom: ["**/*.ts", "!**/index.ts", "!**/*.d.ts"]`, `coverageThreshold: { global: { lines: 70, branches: 60 } }`); add `jest`, `ts-jest` and `@types/jest` as devDependencies only if they aren't hoisted from the root. `packages/shared/tsconfig.build.json` already excludes `**/*.spec.ts`, so specs stay out of `dist/`. `npm run test -w @repo/shared` passes (depends on T005)
- [X] T006 Create `packages/shared/src/observability/metrics-registry.ts`: `createMetricsRegistry(service: string): Registry` that builds a new prom-client `Registry`, sets default labels `{ service }` and calls `collectDefaultMetrics({ register })` (provides `process_resident_memory_bytes` for SC-010). Export it from `packages/shared/src/observability/index.ts` and from `packages/shared/src/index.ts`. Unit spec `packages/shared/src/observability/metrics-registry.spec.ts`: two registries don't share series; `service` label present on a sample counter (depends on T005)
- [X] T007 Create `apps/core_microservice/src/common/observability/metrics.module.ts`: a `@Global()` module providing `METRICS_REGISTRY` (`Symbol.for('MetricsRegistry')`, exported from `apps/core_microservice/src/common/observability/metrics.tokens.ts`) via `createMetricsRegistry('core')`, and import it in `apps/core_microservice/src/app.module.ts` (depends on T006)
- [X] T008 Run `npm run build` from the repo root and `npm run test -w core_microservice`; both must pass before Phase 3

**Checkpoint**: Foundation ready. `METRICS_REGISTRY` is injectable anywhere in core.

---

## Phase 3: User Story 1 - Baseline and before/after evidence (Priority: P1) 🎯 MVP — Batch B1

**Goal**: One command measures p50/p95/error rate and DB queries per request for the six key endpoints on a reproducible perf seed and stores a JSON report; a compare script produces the before/after table. The baseline is captured on pre-optimization code.

**Independent Test**: Seed the perf profile, run `FLOW=legacy npm run perf:baseline` twice, then `npm run perf:compare -- --repeatability baseline baseline-2` exits 0 and both reports list all six endpoint keys (quickstart §1).

### Tests for User Story 1

- [X] T009 [P] [US1] Unit spec `apps/core_microservice/src/common/db/query-context.spec.ts`: counts are isolated between two concurrent `runWithQueryContext` calls, include queries started inside `Promise.all`, and `incrementQueryCount()` outside a context is a no-op
- [X] T010 [P] [US1] Unit spec `apps/core_microservice/src/common/perf/query-count.interceptor.spec.ts`: header `X-Db-Query-Count` set to the integer count when `perfInstrumentation` is true, absent when false

### Implementation for User Story 1

- [X] T011 [P] [US1] Create `apps/core_microservice/src/common/db/query-context.ts`: `AsyncLocalStorage<{ queries: number }>`, `runWithQueryContext(fn)`, `incrementQueryCount()`, `currentQueryCount(): number | undefined`, plus `QueryContextMiddleware` (Nest middleware that wraps `next()` in a new context) (research §2)
- [X] T012 [P] [US1] Create `apps/core_microservice/src/common/db/typeorm-perf.logger.ts`: `TypeOrmPerfLogger implements Logger` (TypeORM). `logQuery()` calls `incrementQueryCount()` and prints nothing; `logQueryError()` logs via `WinstonLogger` the error message and query text only (never the `parameters` argument); `logQuerySlow()` is a no-op placeholder filled in T060; `logSchemaBuild`/`logMigration`/`log` delegate to `WinstonLogger` at `debug`/`info`
- [X] T013 [US1] Wire the counter in `apps/core_microservice/src/app.module.ts`: TypeORM options `logging: ['query', 'error']` and `logger: new TypeOrmPerfLogger(...)`; register `QueryContextMiddleware` for all routes via `configure(consumer)` (depends on T011, T012)
- [X] T014 [US1] Create `apps/core_microservice/src/common/perf/query-count.interceptor.ts` (sets `X-Db-Query-Count` from `currentQueryCount()` just before the response is written, only when `AppConfigService.perfInstrumentation`) and register it as `APP_INTERCEPTOR` in `apps/core_microservice/src/app.module.ts` (depends on T011, T004)
- [X] T015 [US1] Make core refuse to boot when `PERF_INSTRUMENTATION=true` and `NODE_ENV=production`: throw a clear error from `AppConfigService` validation (called during bootstrap in `apps/core_microservice/src/main.ts`), with a case in `apps/core_microservice/src/config/app-config.service.spec.ts` (contracts/observability-http.md "X-Db-Query-Count")
- [X] T016 [P] [US1] Create `seed/perf.ts` (shared by both seeds, next to `seed/fixtures.ts`): `mulberry32(seed)` PRNG with fixed seed `20261020`, `PERF_BASE_DATE = new Date('2026-01-01T00:00:00Z')`, `seedId(kind: string, n: number)` deterministic UUID (sha1 of `perf:${kind}:${n}`, formatted as RFC 4122 with version nibble 5), `PERF_USER_COUNT = 1000`, `perfEmail(n)` = `perf${String(n).padStart(4, '0')}@innogram.dev`, `perfUsername(n)`, `PERF_PASSWORD` (one shared password), `PERF_SEED_VERSION = 1` (research §3)
- [X] T017 [P] [US1] Add `--profile perf` to the auth seed: create `apps/auth_microservice/seed/perf-profile.ts` that inserts 1,000 users with ids `seedId('user', n)` and emails `perfEmail(n)`, hashes `PERF_PASSWORD` **once**, uses multi-row `INSERT … VALUES` in chunks of 1,000 inside one transaction, and with `--reset` deletes only perf users first; dispatch to it from `apps/auth_microservice/seed/seed.ts` when `process.argv` contains `--profile perf` (depends on T016)
- [X] T018 [P] [US1] Add `--profile perf` to the core seed: create `apps/core_microservice/seed/perf-profile.ts` generating, with the T016 PRNG and base date (no `Date.now()`): 1,000 profiles (`authUserId = seedId('user', n)`); 10,000 follows (≈10 per user, skewed so ~20 "popular" users have 150+ followers); 20,000 published posts (≈20 per user, skewed; 30% with 1–3 images pointing at 10 sample objects the seed uploads once to the public bucket); 50,000 comments (30% replies); ~40,000 likes; 200 chats (150 direct, 50 groups of 3–20 members, 20 messages each, with consistent `seq`/`lastSeq`/`lastReadSeq` columns). Multi-row inserts in chunks of 1,000, one transaction per table; `--reset` removes only perf-owned rows. Dispatch from `apps/core_microservice/seed/seed.ts` on `--profile perf` (depends on T016)
- [X] T019 [P] [US1] Create `apps/core_microservice/test/load/k6/lib/report.js`: `buildReport(data, meta)` that turns k6 summary data into the report JSON in `contracts/perf-tooling.md` "Report JSON" (`name`, `createdAt`, `gitRevision`, `seed {profile:'perf', version}`, `loadProfile {vus, rampSec, holdSec, warmupSec, flow}`, `environment {cpu, memGb, os, node, notes}`, `endpoints[] {key, method, route, p50Ms, p95Ms, errorRate, queriesPerRequest {avg, max}, samples}`, `cache` is merged in afterwards by `run-k6.sh`, T131); meta comes from env vars set by the wrapper (T021). For `post_create_image`, `queriesPerRequest` is the **sum** over core sub-requests
- [X] T020 [US1] Create `apps/core_microservice/test/load/k6/key-endpoints.js` with `MODE=measure` (no thresholds) and `FLOW=legacy|current`: `setup()` logs in the first 200 perf users through auth (`AUTH_URL`) and returns tokens handed out round-robin; scenario: 30 s ramp to 20 VUs, 120 s hold, no think time, a 15 s warm-up tagged `phase:warmup` and excluded from stats; per iteration: feed page of 20 → public profile of a random followed user → comments of a random feed post → profile search with a 2–3 char prefix → chat list → every 5th iteration post creation with an image. Every request is tagged `endpoint=<key>` (`feed`, `profile`, `comments`, `profile_search`, `chat_list`, `post_create_image`); custom `Trend`s per endpoint for latency and `db_queries` (from `X-Db-Query-Count`); `post_create_image_duration` Trend over the whole round trip. `FLOW=legacy` uses `GET /posts/feed?page=1&limit=20` and multipart `POST /assets/upload`; `FLOW=current` uses `cursor` and the B5 upload flow (filled in T130). `handleSummary()` writes `test/load/reports/${REPORT}.json` via T019 (depends on T019)
- [X] T021 [US1] Create `apps/core_microservice/test/load/run-k6.sh`: collects `nproc`, total memory, `uname -sr`, `node -v`, `git rev-parse --short HEAD` (+`-dirty` when the tree is dirty), then runs a pinned `grafana/k6:<exact version>` image with `--network host`, the `test/load` directory mounted, and `MODE`, `FLOW` (default `current`), `REPORT` (default `baseline`), `CORE_URL`, `AUTH_URL`, `INTERNAL_API_TOKEN` passed through; propagates k6's exit code (depends on T020)
- [X] T022 [P] [US1] Create `apps/core_microservice/test/load/compare-reports.ts` (run with `ts-node`): `compare-reports.ts <a> <b>` prints a Markdown table `endpoint | p50 before→after | p95 before→after (Δ%) | errors | queries/req before→after | flag`, where `flag` marks endpoints with neither ≥ 30% p95 gain nor fewer avg queries (SC-002); `--repeatability <a> <b>` exits 1 if any endpoint's p95 differs by more than 20% and names it; arguments are report names resolved under `test/load/reports/` or paths
- [X] T023 [US1] Add root scripts to `package.json`: `perf:baseline` → `MODE=measure bash apps/core_microservice/test/load/run-k6.sh`, `perf:compare` → `ts-node apps/core_microservice/test/load/compare-reports.ts` (depends on T021, T022)
- [X] T024 [US1] Capture the baseline on the current (pre-B2) code: `npm run build`, seed both DBs with `--profile perf --reset`, start services as `node dist/main` with `PERF_INSTRUMENTATION=true` (`scripts/impl-services.sh start` or manually), run `FLOW=legacy npm run perf:baseline` and `FLOW=legacy REPORT=baseline-2 npm run perf:baseline`, then `npm run perf:compare -- --repeatability baseline baseline-2` must exit 0. Commit `apps/core_microservice/test/load/reports/baseline.json`. Append to `specs/004-testing-performance/research.md` a "§8 Addendum: baseline findings" with the queries/request per endpoint and whether the chat-list unread `COUNT` is flagged (decides T066) (depends on T013–T023)

**Checkpoint**: `reports/baseline.json` is committed and repeatable within 20%. No optimization code has merged yet.

---

## Phase 4: User Story 2 - Integration suites stay green (Priority: P1) — Batch B1 (harness)

**Goal**: A shared e2e harness for the new suites, and proof that all existing suites pass before behaviour changes. The new suites themselves are listed in the phase of the behaviour they test (T053, T067, T079, T102, T124, T125) and re-run together in T161.

**Independent Test**: `cd apps/core_microservice && npm run test:e2e` and `cd apps/notifications_consumer_microservice && npm run test:e2e` pass (quickstart §2).

- [X] T025 [P] [US2] Create `apps/core_microservice/test/helpers/app.helpers.ts`: `createE2eApp(env?: Record<string, string>)` that sets the given env vars (e.g. `PERF_INSTRUMENTATION=true`, short upload TTLs) **before** importing `AppModule`, builds the Nest app with the same global `ValidationPipe({ whitelist: true, transform: true })` and `DomainExceptionFilter` as `src/main.ts`, and restores env on close. Existing suites are not migrated to it
- [X] T026 [P] [US2] Create `apps/core_microservice/test/helpers/api.helpers.ts`: `bearer(session)`, `internalTokenHeader()` (reads `INTERNAL_API_TOKEN` from the root `.env`), `dbQueryCount(res): number` (parses `X-Db-Query-Count`, throws if absent), and `metricValue(registry, name, labels)` that reads a counter value from a prom-client `Registry`
- [X] T027 [P] [US2] Create `apps/core_microservice/test/helpers/data.helpers.ts`: `createPublishedPosts(http, session, n, { content? })`, `setCreatedAt(db, table, id, isoWithMicros)` (direct SQL, used for tie-breaker tests), and `uniqueSuffix()` for collision-free data
- [X] T028 [US2] Run every existing suite on B1 code — core (`attachments`, `b14-repos`, `notifications-relay`, `profile-posts`, `realtime`, `social`) and notifications (`test/notifications.e2e-spec.ts`) — with infra, auth and notifications running; all must pass. Fix only harness/env problems here, not behaviour
- [X] T029 [US2] Document in `apps/core_microservice/test/README.md` (create) what the e2e suites need running (Postgres, Redis, redis-cache from B4, RabbitMQ, SeaweedFS, auth, notifications for the relay suite) and the new helpers

**Checkpoint**: Harness ready; the 7 existing suites are green. B1 is complete.

---

## Phase 5: User Story 3 - Bounded and stable pagination (Priority: P2) — Batch B2

**Goal**: Every list endpoint enforces an explicit maximum (50, or 200 for message changes) and rejects anything else with 400; the home feed is cursor-only (`page` rejected); follower/following lists and post comments become paged; the client is updated in the same batch.

**Independent Test**: quickstart §3 curls (`limit=100000` → 400, `limit=50` → 200, `page=2` → 400, bad cursor → 400, changes `limit=200` → 200) and `pagination.e2e-spec.ts` (table over every list endpoint plus the concurrent-insert walk).

### Contracts for User Story 3

- [ ] T030 [P] [US3] Create `packages/contracts/src/common/pagination.ts` exactly per `contracts/pagination-http.md`: `export const PAGE_SIZE_MAX = 50; export const CHANGES_PAGE_SIZE_MAX = 200; export interface IOffsetPage<T> { items: T[]; page: number; limit: number; hasMore: boolean }`, and re-export from `packages/contracts/src/common/index.ts`
- [ ] T031 [P] [US3] In `packages/contracts/src/posts/requests.ts` add `IFeedQuery { cursor?: string; limit?: number }`; in `packages/contracts/src/posts/responses.ts` add `IFeedPage { items: IPostResponse[]; nextCursor: string | null }` and **remove** `IFeedResponse` (grep the repo for remaining imports; each is fixed in T040 or T048)
- [ ] T032 [P] [US3] In `packages/contracts/src/follows/requests.ts` add `IFollowListQuery { page?: number; limit?: number }`; in `packages/contracts/src/follows/responses.ts` add `IFollowListItem extends IFollowResponse { isFollowedByMe: boolean }`
- [ ] T033 [P] [US3] Create `packages/contracts/src/comments/requests.ts` with `IListCommentsQuery { page?: number; limit?: number }` and export it from `packages/contracts/src/comments/index.ts`
- [ ] T034 [US3] Run `npm run build -w @repo/contracts -w @repo/shared` (depends on T030–T033)

### Tests for User Story 3

- [ ] T035 [P] [US3] Unit spec `apps/core_microservice/src/modules/posts/domain/feed-cursor.spec.ts`: `encode`→`decode` round-trip preserves microseconds; `decode` returns `null` for bad base64, bad JSON, `v !== 1`, a timestamp not matching `YYYY-MM-DDTHH:MM:SS.ffffffZ`, or a non-uuid `id`
- [ ] T036 [P] [US3] Unit spec `apps/core_microservice/src/modules/posts/dto/feed-query.dto.spec.ts` (class-validator `validate` after `plainToInstance`): `limit` `0`, `-1`, `abc`, `1.5`, `51`, `100000` fail; `50` and absent pass (default 20); any `page` value fails with `page is not supported; use cursor`; malformed `cursor` fails with `cursor is invalid`

### Implementation for User Story 3 (core)

- [ ] T037 [P] [US3] Create `apps/core_microservice/src/modules/posts/domain/feed-cursor.ts`: value object `FeedCursor { v: 1; t: string; id: string }` with `static decode(s): FeedCursor | null`, `static fromRow({ t, id })`, `encode()` = `base64url(JSON.stringify({ v, t, id }))` (data-model §3). `t` is the Postgres text with microseconds, never a JS `Date`
- [ ] T038 [P] [US3] Create `apps/core_microservice/src/modules/posts/dto/is-feed-cursor.validator.ts`: `@IsFeedCursor()` decorator that passes when `FeedCursor.decode(value) !== null`, message `cursor is invalid`
- [ ] T039 [US3] Rewrite `apps/core_microservice/src/modules/posts/dto/feed-query.dto.ts` as `FeedQueryDto implements IFeedQuery`: `cursor` `@IsOptional() @IsFeedCursor()`; `limit` `@IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(PAGE_SIZE_MAX)` default 20; `page?: unknown` declared with `@IsEmpty({ message: 'page is not supported; use cursor' })` so `whitelist` keeps it and it is rejected (research §4, F2) (depends on T037, T038)
- [ ] T040 [US3] Feed keyset query: in `apps/core_microservice/src/modules/posts/domain/interfaces/post-repository.port.ts` replace the offset feed method with `findFeedPage(viewerId, cursor: FeedCursor | null, limit): Promise<{ posts: Post[]; nextCursor: string | null }>`; implement it in `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts` with the ids-first SQL in research §5 (status literal confirmed against `post.entity.ts`; `(createdAt, id) < (:t::timestamptz, :id::uuid)`; `ORDER BY createdAt DESC, id DESC`; `LIMIT limit + 1`; follows as a sub-select, no pre-fetch, no `COUNT`), then hydrate by ids with `author` and `assets.asset` preserving id order; `nextCursor` from the last kept row's raw `t` text, `null` when `≤ limit` rows (depends on T037)
- [ ] T041 [US3] Update `apps/core_microservice/src/modules/posts/posts.service.ts` (`getFeed`: drop the follow pre-fetch, return `IFeedPage`) and `apps/core_microservice/src/modules/posts/posts.controller.ts` (`GET /posts/feed` takes `FeedQueryDto`); update `posts.service.spec.ts` and `posts.controller.spec.ts` in the same folder for the new shape (depends on T039, T040)
- [ ] T042 [P] [US3] Cap the other post lists: `apps/core_microservice/src/modules/posts/dto/search-query.dto.ts` `limit` → `@Type(() => Number) @IsInt() @Min(1) @Max(PAGE_SIZE_MAX)` (default 20 unchanged), and `packages/shared/src/dtos/core/posts-by-author-query.dto.ts` imports `PAGE_SIZE_MAX` instead of the literal `50`
- [ ] T043 [P] [US3] `apps/core_microservice/src/modules/profiles/dto/search-profiles-query.dto.ts`: `limit` max 20 → `PAGE_SIZE_MAX` with `@Type @IsInt @Min(1)`, default 10 unchanged
- [ ] T044 [P] [US3] Chats DTOs: `apps/core_microservice/src/modules/chats/dto/list-chats-query.dto.ts` max → `PAGE_SIZE_MAX` (default 20), `list-messages-query.dto.ts` max 100 → `PAGE_SIZE_MAX` (default 50), `message-changes-query.dto.ts` max 500 → `CHANGES_PAGE_SIZE_MAX` (default 200), all with `@Type @IsInt @Min(1)`. In `apps/core_microservice/src/modules/chats/infrastructure/repository/chat.repository.ts` (~line 29) and `message.repository.ts` (~lines 24–27) keep the clamps only as defense in depth **at or above** the validated maximum
- [ ] T045 [P] [US3] Notifications: make the `GET /notifications` query DTO under `apps/notifications_consumer_microservice/src/modules/notifications/` (the one with `@Max(50)`) import `PAGE_SIZE_MAX` from `@repo/contracts` and use `@Type @IsInt @Min(1)`; add `@repo/contracts` to `apps/notifications_consumer_microservice/package.json` if missing
- [ ] T046 [US3] Follow lists paging: create `apps/core_microservice/src/modules/follows/dto/list-follows-query.dto.ts` (`ListFollowsQueryDto implements IFollowListQuery`: `page` `@Type @IsInt @Min(1)` default 1; `limit` `@Type @IsInt @Min(1) @Max(PAGE_SIZE_MAX)` default 50); add `findFollowers/findFollowing(userId, { offset, limit })` ordered `createdAt DESC, id DESC` fetching `limit + 1`, and `findFollowedAmong(viewerId, userIds[]): Promise<Set<string>>` (one batched `EXISTS … IN` query) to `apps/core_microservice/src/modules/follows/domain/interfaces/follow-repository.port.ts` and `apps/core_microservice/src/modules/follows/infrastructure/repository/follow.repository.ts`; `apps/core_microservice/src/modules/follows/follows.service.ts` returns `IOffsetPage<IFollowListItem>` (`isFollowedByMe` false for anonymous viewers); `apps/core_microservice/src/modules/follows/follows.controller.ts` (`GET /follows/:userId/followers|following`) takes the DTO with optional JWT; update `follows.service.spec.ts` (depends on T034)
- [ ] T047 [US3] Comments paging: create `apps/core_microservice/src/modules/comments/dto/list-comments-query.dto.ts` (`page` default 1, `limit` `1..PAGE_SIZE_MAX` default 20); add `findRootPage(postId, { offset, limit })` (roots only, `createdAt DESC, id DESC`, `limit + 1`) and `findRepliesOf(rootIds[])` (`createdAt ASC, id ASC`) to `apps/core_microservice/src/modules/comments/domain/interfaces/comment-repository.port.ts` and `apps/core_microservice/src/modules/comments/infrastructure/repository/comment.repository.ts`; `apps/core_microservice/src/modules/comments/comments.service.ts` returns `IOffsetPage<ICommentResponse>` with roots first then their replies (`hasMore` counts roots); `apps/core_microservice/src/modules/comments/comments.controller.ts` `GET /comments/post/:postId` takes the DTO; update `comments.service.spec.ts` and `comments.controller.spec.ts` (depends on T034)

### Implementation for User Story 3 (client, same batch — FR-009, FR-040)

- [ ] T048 [P] [US3] `apps/client_app/src/lib/api/feed.ts`: `getFeed({ cursor, limit })` returns `IFeedPage` and never sends `page`; `apps/client_app/src/components/feed/feed-list.tsx`: `useInfiniteQuery` with `initialPageParam: undefined`, `getNextPageParam: (last) => last.nextCursor ?? undefined` (contracts/pagination-http.md "Client"); infinite scroll and the end-of-list state keep working
- [ ] T049 [P] [US3] `apps/client_app/src/lib/api/follows.ts`: `getFollowers/getFollowing(userId, { page, limit })` → `IOffsetPage<IFollowListItem>`; `apps/client_app/src/components/profile/follow-list-dialog.tsx`: `useInfiniteQuery` with "Load more" (next page while `hasMore`), button state from `isFollowedByMe`, remove the fetch of the viewer's whole following list, fix the wrong "newest first" comment (research F4)
- [ ] T050 [P] [US3] `apps/client_app/src/components/comments/comments-api.ts` and `apps/client_app/src/components/comments/post-comments.tsx`: paged fetch with a "Load more comments" control; merge pages by id before calling the existing builder in `comment-tree.ts`, so replies stay nested
- [ ] T051 [US3] Fix every other consumer of the removed `IFeedResponse` or of the old array shapes (grep `apps/client_app/src` for `IFeedResponse`, `getFollowers`, `getFollowing`, comment list calls) and run `npm run build -w client_app` (depends on T048–T050)

### Integration tests for User Story 3

- [ ] T052 [US3] Update `apps/core_microservice/test/social.e2e-spec.ts` and `apps/core_microservice/test/profile-posts.e2e-spec.ts` for the new feed shape (`items`/`nextCursor`), the paged comments and the paged follow lists
- [ ] T053 [US3] Create `apps/core_microservice/test/pagination.e2e-spec.ts` (uses T025–T027): (a) table over **every** list endpoint in contracts/pagination-http.md: `limit=max` → 200; `max+1`, `0`, `-1`, `abc`, `1.5`, `100000` → 400 (SC-007); (b) feed `page=2` → 400 with `page is not supported; use cursor`; malformed cursor → 400 `cursor is invalid`; (c) concurrent-insert walk: page the feed with `limit=5` while 20 posts are inserted between page requests, assert zero duplicates and the collected ids equal the expected pre-existing set; (d) two posts with identical `createdAt` (via `setCreatedAt`) are both returned once across a page boundary; (e) a well-formed cursor whose post was deleted continues after that position; (f) followers/following and comments return `IOffsetPage` with correct `hasMore`
- [ ] T054 [P] [US3] Add a `GET /notifications?limit=51` → 400 and `limit=50` → 200 case to `apps/notifications_consumer_microservice/test/notifications.e2e-spec.ts`
- [ ] T055 [US3] Run the full core and notifications e2e suites and `npm run test -w core_microservice`; all pass (FR-041)
- [ ] T056 [US3] Manual client check (quickstart §3): scroll the home feed to the end — more items load, the list ends cleanly, no request carries `page=`; the follower dialog and comments show "Load more"
- [ ] T057 [US3] Record in `specs/004-testing-performance/research.md` (F6 row) whether the notifications cursor tie-breaker follow-up was done in B2 or deferred

**Checkpoint**: No list endpoint accepts an oversized page; the feed is cursor-only and stable under concurrent inserts; the client works end to end.

---

## Phase 6: User Story 4 - Optimized database queries (Priority: P2) — Batch B3

**Goal**: Slow queries are logged without parameter values; missing indexes are added by migration; redundant queries are removed; list endpoints have a constant query count.

**Independent Test**: `SLOW_QUERY_MS=0` logs `Slow query {durationMs, queryId, query}` with `$1` placeholders and no values; `research.md` §8 addendum shows EXPLAIN before/after using the new `IDX_*` indexes; `X-Db-Query-Count` is equal for `limit=5` and `limit=50` (quickstart §4).

### Tests for User Story 4

- [ ] T058 [P] [US4] Unit spec `apps/core_microservice/src/common/db/typeorm-perf.logger.spec.ts`: `logQuerySlow(250, 'SELECT … WHERE email = $1', ['sentinel.pii@example.com'])` logs `warn 'Slow query'` with `durationMs: 250`, a 12-hex `queryId` that is stable across whitespace differences, the placeholder SQL, and the sentinel string appears **nowhere** in the captured output (SC-012); queries longer than 2 KB are truncated; `logQuery` still increments the counter

### Implementation for User Story 4

- [ ] T059 [US4] Capture "before" plans: on the perf seed run `EXPLAIN (ANALYZE, BUFFERS)` for the feed ids query, root comments page, replies-of-roots, profile search, followers page, following page and chat list, and append them to `specs/004-testing-performance/research.md` "§8 Addendum: EXPLAIN evidence" (must run **before** T061 is applied)
- [ ] T060 [US4] Implement `logQuerySlow(time, query)` in `apps/core_microservice/src/common/db/typeorm-perf.logger.ts`: `warn('Slow query', { durationMs, queryId, query })`, `queryId` = first 12 hex chars of `sha1(query with whitespace collapsed)`, `query` truncated to 2,048 chars; the `parameters` argument is never read (research §9); set `maxQueryExecutionTime: config.slowQueryMs` in the TypeORM options in `apps/core_microservice/src/app.module.ts`
- [ ] T061 [US4] Create migration `apps/core_microservice/src/migrations/<timestamp>-AddPerformanceIndexes.ts` with exactly the six indexes in data-model §2, quoting as in existing migrations: `IDX_posts_feed` on posts `("authorId", "createdAt" DESC, id DESC) WHERE status = 'published' AND "deletedAt" IS NULL`; `IDX_comments_post_roots` on comments `("postId", "createdAt" DESC, id DESC) WHERE "parentId" IS NULL AND "deletedAt" IS NULL`; `IDX_comments_parent` on comments `("parentId") WHERE "deletedAt" IS NULL`; `IDX_follows_following_created` `("followingId", "createdAt" DESC, id DESC)`; `IDX_follows_follower_created` `("followerId", "createdAt" DESC, id DESC)`; `IDX_user_profiles_username_lower` `(lower(username) text_pattern_ops)`. First confirm the `status` enum literal and whether `follows` has `deletedAt` against the entities; partial predicates must match the query predicates exactly. `down()` drops all six. Run `npm run migration:run` and `migration:revert` + `run` once from `apps/core_microservice`
- [ ] T062 [P] [US4] Rewrite profile search in `apps/core_microservice/src/modules/profiles/infrastructure/repository/user-profile.repository.ts` from `username ILIKE 'q%'` to `lower(username) LIKE lower(:q) || '%'` with `%`, `_` and `\` in `q` escaped (`ESCAPE '\'`), so it uses `IDX_user_profiles_username_lower`; prefix semantics unchanged
- [ ] T063 [P] [US4] Remove the duplicate `userDirectory.getUsers` lookup in `apps/core_microservice/src/modules/comments/comments.service.ts` (~line 130; `author` is already joined by the repository) and update `comments.service.spec.ts`
- [ ] T064 [P] [US4] In `apps/core_microservice/src/modules/posts/posts.service.ts` post creation, keep the reload but skip the like-stats and comment-count enrichment queries for the new post (counts 0, `likedByMe` false); update `posts.service.spec.ts`
- [ ] T065 [US4] Verify the follows sub-select and feed predicates in `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts` use `IDX_posts_feed` (adjust the SQL, not the index, if the plan shows a seq scan) (depends on T061)
- [ ] T066 [US4] Chat list unread count, **only if** T024's addendum flagged it: rewrite the correlated per-participant `COUNT` in `apps/core_microservice/src/modules/chats/infrastructure/repository/chat.repository.ts` as `lastSeq - lastReadSeq` adjusted for hidden rows, with `chats.service.spec.ts` updated; otherwise write "not flagged by baseline, unchanged" in the addendum
- [ ] T067 [US4] Add query-count assertions to `apps/core_microservice/test/pagination.e2e-spec.ts` (app built with `PERF_INSTRUMENTATION=true`): `dbQueryCount` is equal for `limit=5` and `limit=50` on the feed, root comments, followers and following (FR-013); add repository cases to `apps/core_microservice/test/b14-repos.e2e-spec.ts` for profile search with `%`/`_` in the query (treated literally)
- [ ] T068 [US4] Capture "after" plans for the same queries as T059 into the research.md §8 addendum, each showing the `IDX_*` index used; run all core unit and e2e suites (all pass)

**Checkpoint**: Slow-query log is live and parameter-free; indexes are migrated; feed/comments/follows have constant query counts.

---

## Phase 7: User Story 5 - Caching of hot, rarely changing data (Priority: P2) — Batch B4

**Goal**: Fail-open cache-aside for public profile fields, follow/post counts and signed attachment links on a separate `redis-cache` instance, invalidated after commit, with hit/miss counters.

**Independent Test**: quickstart §5 — second profile read is a hit; edits and follows are visible on the next read; with `redis-cache` stopped every cached endpoint still returns 2xx without added seconds; `cache.e2e-spec.ts` passes.

### Tests for User Story 5

- [ ] T069 [P] [US5] Unit spec `apps/core_microservice/src/common/cache/redis-cache.adapter.spec.ts` (mocked ioredis): `get` hit/miss JSON round-trip; `set` always uses `EX` with an integer TTL > 0 and throws on TTL ≤ 0; a rejected or timed-out command returns `null`/no-op, increments `cache_requests_total{result="error"}` and logs a rate-limited `warn`
- [ ] T070 [P] [US5] Unit spec `apps/core_microservice/src/modules/profile-summary/profile-summary.service.spec.ts` (extend): cache miss loads from DB and sets both keys with TTL 60; cache hit issues no profile/count queries; `isFollowedByMe` is always computed per request; cache errors fall back to the DB

### Implementation for User Story 5

- [ ] T071 [US5] Add a `redis-cache` service to `docker-compose.yml`: `redis:7-alpine`, command `redis-server --save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru`, host port `6380:6379`, on `innogram-network` (research §6)
- [ ] T072 [P] [US5] Create `apps/core_microservice/src/common/cache/cache-store.port.ts`: `ICacheStore { get<T>(key): Promise<T | null>; set<T>(key, value: T, ttlSec: number): Promise<void>; del(...keys: string[]): Promise<void> }`, `CACHE_STORE = Symbol.for('ICacheStore')`, `type CacheResource = 'profile' | 'follow_counts' | 'signed_url'`
- [ ] T073 [P] [US5] Create `apps/core_microservice/src/common/cache/cache-keys.ts`: `profileKey(authUserId)` = `cache:v1:profile:{authUserId}`, `countsKey(authUserId)` = `cache:v1:counts:{authUserId}`, `signedUrlKey(assetId, disposition)` = `cache:v1:surl:{assetId}:{first 8 hex of sha1(disposition)}`, and TTL constants `PROFILE_TTL_SEC = 60`, `COUNTS_TTL_SEC = 60`, `SIGNED_URL_TTL_SEC = Math.floor(ATTACHMENT_URL_TTL_SECONDS / 2)` (= 450)
- [ ] T074 [US5] Create `apps/core_microservice/src/common/cache/redis-cache.adapter.ts` and `apps/core_microservice/src/common/cache/cache.module.ts` (`@Global()`): a **separate** ioredis client `CACHE_REDIS_CLIENT` from `AppConfigService.cacheRedis` with `commandTimeout: 50`, `connectTimeout: 500`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `retryStrategy: (n) => Math.min(n * 200, 2000)`; the adapter takes the resource label per call, JSON-encodes, records `cache_requests_total{resource, result="hit|miss|error"}` on a Counter registered in `METRICS_REGISTRY`, and never throws (fail open, research §6–7); the client quits on module destroy. Import `CacheModule` in `apps/core_microservice/src/app.module.ts`. The session Redis client in `common/redis/redis.module.ts` is not touched (depends on T072, T073)
- [ ] T075 [US5] Create `apps/core_microservice/src/common/cache/profile-summary-cache.ts` (injectable, exported by `CacheModule`): `getProfile/setProfile`, `getCounts/setCounts`, `invalidateProfile(authUserId)`, `invalidateCounts(...authUserIds)`; profile value is exactly `{ id, authUserId, username, displayName, bio, avatarUrl, createdAt }` and counts `{ followerCount, followingCount, postCount }`, never viewer data (data-model §4) (depends on T074)
- [ ] T076 [US5] Cache-aside in `apps/core_microservice/src/modules/profile-summary/profile-summary.service.ts`: read profile and counts through `ProfileSummaryCache` (60 s), compute `isFollowedByMe` per request, existing guards keep running before any cache read (FR-020) (depends on T075)
- [ ] T077 [US5] Invalidate **after** the write's transaction resolves (never inside it): `apps/core_microservice/src/modules/profiles/profiles.service.ts` (profile edit, avatar change, profile creation → `invalidateProfile`); `apps/core_microservice/src/modules/follows/follows.service.ts` (follow/unfollow → `invalidateCounts(followerId, followingId)`); `apps/core_microservice/src/modules/posts/posts.service.ts` (publish, delete, create-as-published → `invalidateCounts(authorId)`); add one spec case per trigger in the matching `*.service.spec.ts` (depends on T075)
- [ ] T078 [US5] Signed-link cache in `apps/core_microservice/src/modules/chats/infrastructure/storage/attachment-storage.adapter.ts`: `presign()` takes the asset id (extend `PresignableAttachment` in `apps/core_microservice/src/modules/chats/domain/interfaces/attachment-storage.port.ts` with `id`), looks up `signedUrlKey(id, disposition)`, serves an entry only if `expiresAt - now ≥ ATTACHMENT_URL_TTL_SECONDS / 2`, else re-signs and stores `{ url, expiresAt }` with TTL 450 s; `softDeleteAssets()` callers in `apps/core_microservice/src/modules/chats/messages.service.ts` (message delete) and `apps/core_microservice/src/modules/assets/assets.service.ts` (asset deletion) delete the matching keys after commit (the adapter exposes `invalidateSignedUrls(assetIds)` that removes both disposition variants). Participant authorization stays before `presign()` (FR-020). Update `messages.service.spec.ts` (depends on T074)
- [ ] T079 [US5] Create `apps/core_microservice/test/cache.e2e-spec.ts`: (a) first `GET /profiles/by-user/:userId` → `profile` miss, second → hit (read from `METRICS_REGISTRY` via `metricValue`); (b) edit profile → next read returns the new bio; (c) follow and unfollow → both users' counts fresh on the next read; (d) publish a post → author `postCount` fresh; (e) every `cache:v1:*` key has `TTL > 0`; (f) a returned signed attachment URL has ≥ 7.5 min left (`X-Amz-Date` + `X-Amz-Expires`); (g) a second app built with `CACHE_REDIS_PORT` pointing at a closed port answers 20/20 profile, chat-list and message requests with 2xx and no request slower than 300 ms because of the cache (SC-008)
- [ ] T080 [US5] Manual check per quickstart §5 with `docker compose stop redis-cache` / `start redis-cache`; run all core unit and e2e suites (all pass)

**Checkpoint**: Cached reads hit after the first request, are fresh after writes and survive a cache outage.

---

## Phase 8: User Story 6 - Efficient and safe file uploads (Priority: P2) — Batch B5

**Goal**: Two-step direct-to-storage uploads (presigned POST → browser → confirm) with content sniffing, size checks, promotion to the public bucket, and a sweeper for unconfirmed uploads; old multipart endpoints removed; client updated.

**Independent Test**: `uploads.e2e-spec.ts` covers every row of quickstart §6; in the client a post image, an avatar and a chat attachment work as before and a 12 MB file shows "File is larger than 10 MB".

### Setup for User Story 6

- [ ] T081 [US6] Add `@aws-sdk/s3-presigned-post` (same minor as the installed `@aws-sdk/client-s3`) to dependencies in `apps/core_microservice/package.json` and run `npm install`
- [ ] T082 [P] [US6] In `docker-compose.yml` (and `docker/seaweedfs/entrypoint.sh` if the S3 flags are set there) start SeaweedFS S3 with `-s3.allowedOrigins=${CLIENT_URL:-http://localhost:3000}` instead of the default `*` (research §10, F14)
- [ ] T083 [P] [US6] Create `packages/contracts/src/uploads/requests.ts` (`UploadPurpose = 'post-image' | 'avatar' | 'chat-attachment'`; `ICreateUploadRequest { purpose; contentType; size; fileName? }`), `packages/contracts/src/uploads/responses.ts` (`IUploadTicket { uploadId; url; fields: Record<string, string>; maxBytes; expiresAt }`), `packages/contracts/src/uploads/constants.ts` (`UPLOAD_MAX_BYTES = 10 * 1024 * 1024` re-using `ATTACHMENT_MAX_BYTES`, `UPLOAD_LINK_TTL_SECONDS = 300`, `UPLOAD_ALLOWLIST`: `post-image` and `avatar` → `image/jpeg`, `image/png`, `image/webp`, `image/gif`; `chat-attachment` → the existing `ATTACHMENT_MIME_TYPES`), an `index.ts`, export from `packages/contracts/src/index.ts`, then build contracts

### Tests for User Story 6

- [ ] T084 [P] [US6] Unit spec `apps/core_microservice/src/modules/assets/domain/entities/asset.entity.spec.ts`: every rule in data-model §1 "Entity rules" — `createPending` size `0` and `10 MiB + 1` → `UploadTooLargeError`, mime outside the purpose allowlist → `UploadTypeNotAllowedError`, keys `pending/{uploaderId}/{id}` vs `chat/{uploaderId}/{id}`; `assertStoredSizeAcceptable` with `0` and `10 MiB + 1` → `UploadTooLargeError`, `10 MiB` passes; `assertConfirmableBy` expiry with 60 s grace → `UploadExpiredError`; `confirm` only from `PENDING` (`UploadNotPendingError`), sets detected mime, actual size, `PUBLIC` for `post-image`/`avatar`, clears `expiresAt`; `reject` soft-deletes; `assertAttachableTo` purpose matrix and legacy null-purpose rows; `isSweepable`
- [ ] T085 [P] [US6] Unit spec `apps/core_microservice/src/modules/assets/infrastructure/content/file-type-content-sniffer.spec.ts`: JPEG/PNG/WebP/GIF accepted for `post-image`; PNG-declared EXE bytes, SVG and HTML rejected; plain/CSV attachments must be valid UTF-8 with no NUL; PDF accepted for `chat-attachment`; returns the **detected** mime
- [ ] T086 [P] [US6] Unit spec `apps/core_microservice/src/modules/assets/uploads.service.spec.ts`: every row of the confirm error table in contracts/uploads-http.md (404 unknown/foreign, `UploadExpiredError`, `UploadNotReadyError` when `head` is null, `UploadTooLargeError` deletes object + soft-deletes, `UploadContentRejectedError` deletes object + soft-deletes), idempotent second confirm, public promotion with `copyToPublic` + pending delete, promoted object deleted when the final save fails, `uploads_total{purpose, outcome}` incremented

### Implementation for User Story 6

- [ ] T087 [US6] Create migration `apps/core_microservice/src/migrations/<timestamp>-AddUploadLifecycleToAssets.ts` per data-model §1: `status varchar(16) NOT NULL DEFAULT 'READY'` (`'PENDING' | 'READY'`), `purpose varchar(32) NULL` (`'post-image' | 'avatar' | 'chat-attachment'`), `expiresAt timestamptz NULL`; backfill `purpose = 'chat-attachment'` where `"storageKey" LIKE 'chat/%'`; index `IDX_assets_pending_expiry ("expiresAt") WHERE status = 'PENDING'`; `down()` reverses everything. Run it from `apps/core_microservice`
- [ ] T088 [US6] Add the upload domain errors to `apps/core_microservice/src/modules/assets/domain/errors/asset.errors.ts` (all `DomainError` → 400): `UploadTooLargeError`, `UploadTypeNotAllowedError`, `UploadExpiredError`, `UploadNotReadyError`, `UploadNotPendingError`, `UploadContentRejectedError` (message `File content is not an allowed type`), `AssetNotAttachableError`
- [ ] T089 [US6] Extend `apps/core_microservice/src/modules/assets/domain/entities/asset.entity.ts` with the `status`, `purpose`, `expiresAt` columns and the methods in data-model §1 (`static createPending`, `assertConfirmableBy`, `assertStoredSizeAcceptable`, `confirm`, `reject`, `assertAttachableTo`, `isSweepable`) (depends on T087, T088)
- [ ] T090 [P] [US6] Extend `apps/core_microservice/src/modules/assets/domain/interfaces/file-storage.port.ts` with `presignPost({ bucket, key, contentType, maxBytes, expiresSec }): Promise<{ url; fields }>`, `head(bucket, key): Promise<{ size: number; contentType?: string } | null>`, `readHead(bucket, key, bytes): Promise<Buffer>`, `copyToPublic(srcBucket, srcKey, destKey): Promise<string /* public url */>` and `deleteObject(bucket, key)` if not present
- [ ] T091 [US6] Implement them in `apps/core_microservice/src/modules/assets/infrastructure/storage/s3-storage.adapter.ts`: `presignPost` via `createPresignedPost` on the presign client (`S3_PUBLIC_ENDPOINT`) with conditions `{bucket}`, `{key}` exact, `['content-length-range', 1, 10485760]`, `{'Content-Type': declared}`, expiry `uploads.linkTtlSec`; `head` → `HeadObject` (404 → `null`); `readHead` → `GetObject` with `Range: bytes=0-{n-1}` read fully (≤ n bytes); `copyToPublic` → `CopyObject` into the public bucket. Unit spec `s3-storage.adapter.spec.ts` with `S3Client.send` mocked (depends on T081, T090)
- [ ] T092 [P] [US6] Create `apps/core_microservice/src/modules/assets/domain/interfaces/content-sniffer.port.ts` (`IContentSniffer.detect(head: Buffer, declaredMime, purpose): Promise<{ allowed: boolean; detectedMime?: string }>`, `CONTENT_SNIFFER` token) and adapter `apps/core_microservice/src/modules/assets/infrastructure/content/file-type-content-sniffer.ts` reusing Nest's `FileTypeValidator` on a synthetic `{ buffer: head, mimetype: declared, size }` with `fallbackToMimetype: true, overrideMimeType: true` and the `UPLOAD_ALLOWLIST[purpose]` regex (same behaviour as `chats/attachments.controller.ts`, research F12); SVG never allowed; text types additionally UTF-8-valid with no NUL
- [ ] T093 [P] [US6] Create `apps/core_microservice/src/modules/assets/domain/interfaces/upload-repository.port.ts` (`IUploadRepository`: `findById`, `save`, `claimSweepable(limit, graceSec): Promise<Asset[]>` using `FOR UPDATE SKIP LOCKED` inside a transaction, `hardDelete(ids)`) and adapter `apps/core_microservice/src/modules/assets/infrastructure/repository/upload.repository.ts`; make every existing asset read in `apps/core_microservice/src/modules/assets/infrastructure/repository/asset.repository.ts` and `attachment-storage.adapter.ts` `findAssets` return only `status = 'READY'` rows (unconfirmed uploads are never visible)
- [ ] T094 [US6] Create `apps/core_microservice/src/modules/assets/uploads.service.ts`: `createUpload(sub, dto)` (`Asset.createPending`, save, `presignPost`, return `IUploadTicket` with `maxBytes = UPLOAD_MAX_BYTES`) and `confirm(sub, uploadId)` implementing research §11 steps 1–8 (404 for missing/foreign, idempotent `READY`, expiry, `head` (null → `UploadNotReadyError`), `asset.assertStoredSizeAcceptable(head.size)` (on `UploadTooLargeError`: delete the object, `asset.reject()`, save, rethrow), `readHead(4100)`, sniff, promote public purposes to `{assetId}{ext from detected type}` then delete pending, `asset.confirm`, cleanup on save failure); `uploads_total{purpose, outcome}` counter on `METRICS_REGISTRY` (depends on T089, T091, T092, T093)
- [ ] T095 [US6] Create `apps/core_microservice/src/modules/assets/dto/create-upload.dto.ts` (`CreateUploadDto implements ICreateUploadRequest`: `purpose` `@IsIn([...])`, `contentType` `@IsString()`, `size` `@IsInt() @Min(1) @Max(UPLOAD_MAX_BYTES)`, `fileName` `@IsOptional() @IsString() @MaxLength(255)`) and `apps/core_microservice/src/modules/assets/uploads.controller.ts` (`JwtAuthGuard`; `POST /uploads` → 201 `IUploadTicket`; `POST /uploads/:uploadId/confirm` with `ParseUUIDPipe` → 200 `IAssetResponse` for `post-image`/`avatar` or `IUploadedAttachment` for `chat-attachment`); register in `apps/core_microservice/src/modules/assets/assets.module.ts` with the new port bindings; controller spec `uploads.controller.spec.ts` (depends on T094)
- [ ] T096 [US6] Create `apps/core_microservice/src/modules/assets/infrastructure/pending-upload.sweeper.ts`: unref'd `setInterval` every `uploads.sweepIntervalSec` (pattern of `common/messaging/outbox-relay.ts`), public `tick()` that claims ≤ 500 rows with `status = 'PENDING' AND "expiresAt" < now() - grace`, deletes each object (missing is OK), then hard-deletes the rows; started in `onModuleInit`, cleared in `onModuleDestroy`; unit spec `pending-upload.sweeper.spec.ts` (depends on T093)
- [ ] T097 [US6] Consumers: `apps/core_microservice/src/modules/posts/posts.service.ts` create loads each `assetId` and calls `asset.assertAttachableTo('post', sub)` (404 for missing/foreign, fixes F11); `apps/core_microservice/src/modules/profiles/infrastructure/avatar-asset.adapter.ts` requires `'avatar'`; the message attachment check in `apps/core_microservice/src/modules/chats/messages.service.ts` adds `READY`/`'message'`; update the matching specs (depends on T089)
- [ ] T098 [US6] Remove `POST /assets/upload` from `apps/core_microservice/src/modules/assets/assets.controller.ts` (and its `assets.service.ts` method + spec cases) and `POST /chats/attachments` from `apps/core_microservice/src/modules/chats/attachments.controller.ts` (delete the controller and `attachments.controller.spec.ts` if nothing else remains; drop `upload()` from `IAttachmentStoragePort`); remove multer imports/deps only if no route still uses them (depends on T095)
- [ ] T099 [P] [US6] Client: create `apps/client_app/src/lib/api/uploads.ts` `uploadFile(file, purpose, onProgress)`: `POST /uploads` → `XMLHttpRequest` multipart POST to `ticket.url` with every `fields` entry first and `file` last (progress events) → on non-2xx map `EntityTooLarge` to "File is larger than 10 MB", else "Upload failed, please try again", and do **not** confirm → `POST /uploads/:uploadId/confirm`; reject files over `UPLOAD_MAX_BYTES` before requesting a ticket
- [ ] T100 [US6] Client: switch `apps/client_app/src/lib/api/assets.ts`, `apps/client_app/src/lib/api/chats.ts`, `apps/client_app/src/components/posts/create-post-dialog.tsx` (`post-image`), `apps/client_app/src/components/profile/edit-profile-form.tsx` (`avatar`) and `apps/client_app/src/components/chat/attachment-picker.tsx` (`chat-attachment`, keep progress UI) to `uploadFile`; remove the old multipart helpers; `npm run build -w client_app` (depends on T099)
- [ ] T101 [US6] Migrate `apps/core_microservice/test/attachments.e2e-spec.ts` (and any upload in `profile-posts.e2e-spec.ts`) to the new flow; add `presignedUpload(http, session, purpose, bytes, mime)` to `apps/core_microservice/test/helpers/attachment.helpers.ts` that does sign → multipart POST to storage → confirm
- [ ] T102 [US6] Create `apps/core_microservice/test/uploads.e2e-spec.ts` (app via `createE2eApp` with short `UPLOAD_LINK_TTL_SEC` and `UPLOAD_SWEEP_GRACE_SEC=0`) covering every row of quickstart §6: PNG 200 KB → confirm → `POST /posts` shows a public-bucket URL; `.exe` bytes declared `image/png` → 400 `UploadContentRejectedError`, object gone, no READY asset; 11 MiB → storage 400 `EntityTooLarge`, confirm 400 `UploadNotReadyError`; confirm by another user / unknown id → 404; signed fields with a different key → storage 403; expired link → storage 403 and confirm 400 `UploadExpiredError`; confirm twice → same body, one asset; never confirmed + `sweeper.tick()` → row and object removed and the asset never appears in any read; `POST /posts` with another user's READY asset or a PENDING asset → 400/404; removed endpoints `POST /assets/upload` and `POST /chats/attachments` → 404
- [ ] T103 [US6] Manual client check (quickstart §6): create a post with an image, change the avatar, send a chat attachment — all look as before; a 12 MB file shows "File is larger than 10 MB"
- [ ] T104 [US6] Run all core unit and e2e suites (all pass)

**Checkpoint**: Upload bytes go straight to storage; only allowed content becomes an asset; unconfirmed uploads disappear.

---

## Phase 9: User Story 7 - Health and metrics endpoints (Priority: P3) — Batch B6

**Goal**: `GET /health` (public, status only), `GET /health/details` and `GET /metrics` (internal token) on the normal port of core, auth and notifications, built from one shared implementation; `INTERNAL_API_TOKEN` fail-fast; optional monitoring profile.

**Independent Test**: quickstart §7 loop over ports 3001/3002/3003 — public health JSON, 401 without/with wrong token, the required metric families with a token; pausing Postgres yields 503 `unhealthy` in < 2 s.

### Contracts & shared code for User Story 7

- [ ] T105 [P] [US7] Create `packages/contracts/src/observability/health.ts` exactly per data-model §7 (`HealthStatus`, `IHealthStatus`, `IHealthCheckResult { status: 'up' | 'down'; critical: boolean; latencyMs: number; error?: string }`, `IHealthReport { status; service; checkedAt; checks: Record<string, IHealthCheckResult> }`), an `index.ts`, export from `packages/contracts/src/index.ts`
- [ ] T106 [P] [US7] Create `packages/shared/src/observability/health-runner.ts`: `runHealthChecks(service, checks: { name; critical; run(): Promise<void> }[], { timeoutMs = 1000 })` → `IHealthReport`; checks run in parallel, each raced against the timeout (`error: 'timeout'`); `error` is a short class name or message, never a connection string; rollup: any critical down → `unhealthy`, else any down → `degraded`, else `healthy`; plus `httpStatusFor(status)` (`unhealthy` → 503, else 200). Spec `health-runner.spec.ts`: a hanging check resolves the run in ≤ 1.1 s and is `down`; rollup table
- [ ] T107 [P] [US7] Create `packages/shared/src/observability/internal-token.ts`: `isValidInternalToken(header, expected)` comparing SHA-256 digests with `timingSafeEqual` (any input length); `assertInternalApiToken(value)` throws unless a string of ≥ 32 chars; `requireInternalToken(expected)` Express middleware → 401 `{"statusCode":401,"message":"Unauthorized"}`. Spec `internal-token.spec.ts`: missing, wrong same-length, wrong different-length, correct
- [ ] T108 [P] [US7] Create `packages/shared/src/observability/http-metrics.middleware.ts`: `httpMetricsMiddleware(registry)` (Express-compatible) registering `http_request_duration_seconds{method, route, status_class}` histogram (buckets 0.005–5 s) and `http_request_errors_total{method, route, status_class}` (4xx/5xx); `route` = `req.baseUrl + req.route.path` on `finish`, `unmatched` if no route; `/health`, `/health/details`, `/metrics` excluded. Spec with a small Express app + supertest: `/posts/:id` template label, `2xx`/`4xx` classes, excluded paths
- [ ] T109 [P] [US7] Create `packages/shared/src/observability/db-pool.metrics.ts`: `registerDbPoolGauge(registry, getPool: () => { totalCount; idleCount; waitingCount } | undefined)` → `db_pool_connections{state="total|idle|waiting"}` collected on scrape
- [ ] T110 [US7] Export T106–T109 from `packages/shared/src/observability/index.ts` and `packages/shared/src/index.ts`, then `npm run build -w @repo/contracts -w @repo/shared` (depends on T105–T109)

### Core

- [ ] T111 [P] [US7] Create core checks in `apps/core_microservice/src/common/observability/checks/`: `database.check.ts` (`SELECT 1`, critical), `session-redis.check.ts` (`PING` on the session client, critical), `cache-redis.check.ts` (`PING` on `CACHE_REDIS_CLIENT`, non-critical), `broker.check.ts` (connection state from `common/messaging/amqp-connection.provider.ts`, non-critical), `object-storage.check.ts` (`HeadBucket`, non-critical) — names exactly `database`, `session_redis`, `cache_redis`, `broker`, `object_storage` (contracts/observability-http.md)
- [ ] T112 [US7] Create `apps/core_microservice/src/common/observability/internal-token.guard.ts` (Nest `CanActivate` using `isValidInternalToken` with `AppConfigService.internalApiToken`, throws `UnauthorizedException` with message `Unauthorized`), `health.controller.ts` (`GET /health` → `{ status }` only; `GET /health/details` guarded → full `IHealthReport`; HTTP status via `httpStatusFor`), `metrics.controller.ts` (`GET /metrics` guarded, `Content-Type: text/plain; version=0.0.4; charset=utf-8`, `registry.metrics()`), and `observability.module.ts`; import it in `apps/core_microservice/src/app.module.ts`; make sure no global JWT guard applies to these routes (depends on T110, T111)
- [ ] T113 [US7] In `apps/core_microservice/src/main.ts` add `app.use(httpMetricsMiddleware(registry))` (registry from `METRICS_REGISTRY`) before routes, and `registerDbPoolGauge` with the TypeORM pg pool (`dataSource.driver.master`) (depends on T110)
- [ ] T114 [US7] Feed `db_queries_per_request{route}` (histogram, buckets 1–50) from `apps/core_microservice/src/common/perf/query-count.interceptor.ts` on every request (route template label), while the `X-Db-Query-Count` header stays gated by `PERF_INSTRUMENTATION`; extend `query-count.interceptor.spec.ts`

### Notifications

- [ ] T115 [P] [US7] Create `apps/notifications_consumer_microservice/src/common/observability/` with the same shape as core: `metrics.module.ts` (`createMetricsRegistry('notifications')`), `internal-token.guard.ts`, `health.controller.ts`, `metrics.controller.ts`, `observability.module.ts`, and checks `database` (critical), `session_redis` (critical), `broker` (critical — consuming is the service's purpose), `smtp` (`transporter.verify()`, non-critical); import in the root app module; `app.use(httpMetricsMiddleware(...))` and `registerDbPoolGauge` in `apps/notifications_consumer_microservice/src/main.ts` (depends on T110)
- [ ] T116 [US7] Make `INTERNAL_API_TOKEN` fail-fast at bootstrap in `apps/notifications_consumer_microservice/src/config/app-config.service.ts` (currently read lazily, research F16) using `assertInternalApiToken`; unit spec for missing and 31-char tokens

### Auth

- [ ] T117 [P] [US7] Create `apps/auth_microservice/src/infrastructure/health/database.check.ts` (`SELECT 1`, critical) and `redis.check.ts` (`PING`, critical); in `apps/auth_microservice/src/app.ts` `createApp()` create `createMetricsRegistry('auth')`, `app.use(httpMetricsMiddleware(registry))`, `registerDbPoolGauge`, and mount on the **main** app `GET /health`, `GET /health/details` and `GET /metrics` (the latter two behind `requireInternalToken(env.INTERNAL_API_TOKEN)`); switch `apps/auth_microservice/src/middleware/internal-token.middleware.ts` to the shared `isValidInternalToken` (depends on T110)

### Core fail-fast and monitoring profile

- [ ] T118 [US7] Validate `INTERNAL_API_TOKEN` at bootstrap in core with `assertInternalApiToken` (from `AppConfigService`, called before `listen` in `apps/core_microservice/src/main.ts`); add the case to `app-config.service.spec.ts`
- [ ] T119 [P] [US7] Create `docker/monitoring/prometheus.yml` (scrape core :3001, auth :3002, notifications :3003 via `host.docker.internal`, `http_headers: { X-Internal-Token: { files: [/run/secrets/internal_token] } }`) and an entrypoint script that writes `/run/secrets/internal_token` from `INTERNAL_API_TOKEN`
- [ ] T120 [P] [US7] Create `docker/monitoring/grafana/provisioning/datasources/prometheus.yml`, `docker/monitoring/grafana/provisioning/dashboards/dashboards.yml` and `docker/monitoring/grafana/dashboards/innogram-overview.json` (dashboard "Innogram overview": p95 by route, error rate, cache hit ratio, pool usage, RSS)
- [ ] T121 [US7] Add `prometheus` (pinned `prom/prometheus:3.x.y`) and `grafana` (pinned `grafana/grafana:<exact>`, host port 3030) services under `profiles: ["monitoring"]` in `docker-compose.yml`, with `extra_hosts: host.docker.internal:host-gateway`; nothing else depends on them (FR-030) (depends on T119, T120)

### Integration tests for User Story 7

- [ ] T122 [P] [US7] Unit spec `apps/core_microservice/src/common/observability/health.controller.spec.ts`: public body contains only `status`; details returns all five checks; `unhealthy` → 503
- [ ] T123 [P] [US7] Auth supertest spec `apps/auth_microservice/src/app.observability.spec.ts` on `createApp()` with mocked ports/checks: `/health` → `{status}`; `/metrics` and `/health/details` → 401 without or with a wrong token, 200 with the token and the `http_request_duration_seconds`, `http_request_errors_total`, `db_pool_connections` families
- [ ] T124 [US7] Create `apps/core_microservice/test/observability.e2e-spec.ts`: `/health` 200 `{status:'healthy'}` with no dependency names; `/metrics` and `/health/details` 401 without/with wrong token (body exactly `{"statusCode":401,"message":"Unauthorized"}`); with the token, the details have the five checks and `/metrics` has `http_request_duration_seconds`, `http_request_errors_total`, `db_pool_connections`, `cache_requests_total`, `db_queries_per_request`, `uploads_total` and a `service="core"` label, and the request histogram count grows after traffic; an app with the cache pointed at a closed port reports `degraded` with `cache_redis` down; an app with a check overridden to hang still answers `/health` in < 2 s (FR-027, SC-011)
- [ ] T125 [P] [US7] Create `apps/notifications_consumer_microservice/test/observability.e2e-spec.ts` with the same token, shape and families assertions for notifications (checks `database`, `session_redis`, `broker`, `smtp`)
- [ ] T126 [US7] Run the quickstart §7 loop on all three ports, including `docker compose pause postgres` → core `/health` 503 `unhealthy` in < 2 s; run all unit and e2e suites (all pass)

**Checkpoint**: Every backend service is probe-able and scrape-able; internal endpoints reject missing/wrong tokens.

---

## Phase 10: User Story 8 - Repeatable performance tests with pass/fail thresholds (Priority: P1) — Batch B7

**Goal**: `npm run perf` load-tests the six key endpoints with per-endpoint p95/error thresholds plus the chat fan-out, and exits non-zero naming the failing `endpoint:metric`; final report and PR table captured; upload memory proof.

**Independent Test**: `npm run perf` exits 0 on the reference environment; temporarily setting the feed threshold to `p(95)<1` makes it exit non-zero naming `http_req_duration{endpoint:feed}` (quickstart §8).

- [ ] T127 [P] [US8] Create `apps/core_microservice/test/load/k6/thresholds.js` with exactly the data-model §6 / contracts/perf-tooling.md values: `http_req_duration{endpoint:feed|profile|comments|profile_search|chat_list}` → `['p(95)<300']`, `post_create_image_duration` → `['p(95)<1000']`, `http_req_failed{endpoint:<each key>}` → `['rate<0.01']`, all with `abortOnFail: false`
- [ ] T128 [P] [US8] Create a deterministic 512 KB–1 MB PNG fixture at `apps/core_microservice/test/load/k6/fixtures/perf-image.png` (generated by a small committed script `apps/core_microservice/test/load/k6/fixtures/make-image.ts`, so the bytes are reproducible)
- [ ] T129 [US8] Add `MODE=gate` to `apps/core_microservice/test/load/k6/key-endpoints.js`: same scenarios with `options.thresholds` from T127; `handleSummary()` prints a per-endpoint p50/p95/error table and the names of failed thresholds; k6's exit code (99 on threshold failure) is the command's exit code (depends on T127)
- [ ] T130 [US8] Implement `FLOW=current` for `post_create_image` in `apps/core_microservice/test/load/k6/key-endpoints.js`: `POST /uploads` → multipart POST of the fixture to storage with `http.file` (fields first) → `POST /uploads/:id/confirm` → `POST /posts` with the asset id; every sub-request tagged `endpoint=post_create_image`; `post_create_image_duration` measures the whole round trip; feed uses `cursor` (depends on T128)
- [ ] T131 [US8] Cache hit ratio (SC-009) in `apps/core_microservice/test/load/run-k6.sh`: before starting k6 and after it exits, GET `${CORE_URL}/metrics` with `X-Internal-Token` and sum `cache_requests_total{resource="profile",result="hit"}` and `{…result="miss"}`, ignoring other labels such as `service`. Parse the samples with a small `node -e` helper, not jq. Compute `ratio = Δhit / (Δhit + Δmiss)` and merge `cache: { profileHitRatio }` into `test/load/reports/${REPORT}.json`. In `MODE=gate`, if k6 exited 0 but the ratio is below 0.8, print `FAILED cache:profileHitRatio <value> < 0.80` and exit 1. The delta includes warm-up traffic, which makes the check conservative; say so in the README (T134). Skip with a warning when `/metrics` returns 404, as on pre-B6 code
- [ ] T132 [US8] Add the root script `perf` to `package.json`: `MODE=gate bash apps/core_microservice/test/load/run-k6.sh && npx ts-node apps/core_microservice/test/load/group-fanout.ts --members 100 --messages 50` (fails if either fails; fan-out keeps `P95_TARGET_MS = 2000`)
- [ ] T133 [P] [US8] Create `apps/core_microservice/test/load/upload-memory.ts` and `perf:upload-memory` in `apps/core_microservice/package.json`: 20 concurrent 10 MiB uploads through sign → storage → confirm, sampling `process_resident_memory_bytes` from `/metrics` every 250 ms; prints `peak RSS delta: NN MiB (< 50 MiB) ✓` and exits non-zero if the delta is ≥ 50 MiB or any upload is not confirmed (US6 AS4, SC-010)
- [ ] T134 [P] [US8] Create `apps/core_microservice/test/load/README.md` (FR-033): commands from contracts/perf-tooling.md, the load profile table (20 VUs, 30 s ramp, 120 s hold, 15 s warm-up excluded, no think time, scenario mix), the threshold table, the reference environment (≥ 4 cores, ≥ 16 GB RAM, Linux, infra via `docker compose up`, services as `node dist/main` with `NODE_ENV=development`, `PERF_INSTRUMENTATION=true` for measure runs only, logging `info`), and how to read a failure
- [ ] T135 [US8] Capture the final evidence on the perf seed: `FLOW=current REPORT=final npm run perf:baseline` → commit `apps/core_microservice/test/load/reports/final.json`; `npm run perf:compare -- baseline final > apps/core_microservice/test/load/reports/comparison.md` (commit it; it is pasted into the PR); for every endpoint flagged by SC-002 add a written explanation under the table (plan risk (b): never loosen a threshold silently)
- [ ] T136 [US8] Run `npm run perf` (exit 0), then verify the failure path by temporarily setting the feed threshold to `p(95)<1` (non-zero exit naming `http_req_duration{endpoint:feed}`) and revert; run `npm run perf:upload-memory -w core_microservice` (exit 0)

**Checkpoint**: The perf gate is green on the reference environment; `final.json` and `comparison.md` are committed.

---

## Phase 11: User Story 9 - Browser end-to-end tests for main flows (Priority: P1) — Batch B8

**Goal**: Playwright tests run with one command against the running stack and cover register/login → feed, post with image, comment + reply, live chat message; unique data per run; trace and screenshot on failure.

**Independent Test**: three consecutive `npm run e2e` runs pass with no manual cleanup; a forced failure leaves `trace.zip` and a screenshot in `apps/client_app/e2e/.artifacts/` (quickstart §9).

- [ ] T137 [US9] Add `@playwright/test` pinned to an exact version to devDependencies in `apps/client_app/package.json`, scripts `test:e2e` (`playwright test`) in `apps/client_app/package.json` and `e2e` (`npm run test:e2e -w client_app --`) in the root `package.json`; run `npm install` and `npx playwright install chromium`
- [ ] T138 [US9] Create `apps/client_app/playwright.config.ts` (research §13): `testDir: 'e2e'`, `baseURL` from `CLIENT_URL` (default `http://localhost:3000`), Chromium project only, `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `video: 'off'`, `retries: 0`, `workers: 2`, `outputDir: 'e2e/.artifacts'`, **no** `webServer`; exclude `e2e/**` from the Next/tsconfig build if needed (depends on T137)
- [ ] T139 [P] [US9] Create `apps/client_app/e2e/fixtures/run-id.ts`: `uniqueUser(label: string)` returns a fresh user **on every call** (`e2e_${label}_${randomBytes(5).toString('hex')}` for the username and the same with `@innogram.dev` for the email, plus a shared strong password). Check the result against core's username length and charset rules. Never compute ids at module scope: workers reuse modules across `--repeat-each` iterations and retries. Call it inside each test or fixture
- [ ] T140 [P] [US9] Create `apps/client_app/e2e/fixtures/api.ts` (register + login a setup user through the auth API at `AUTH_URL` (default `http://localhost:3002`), follow and create-direct-chat helpers through core at `CORE_URL`, and `loginInBrowser(page, user)` that signs in through the UI) and `apps/client_app/e2e/fixtures/test.ts` (Playwright `test.extend` that collects `console` errors and fails the test if any appear); add `apps/client_app/e2e/fixtures/image.png` (small valid PNG)
- [ ] T141 [P] [US9] Add `data-testid`s where roles are ambiguous: `feed-item` on the post card root in `apps/client_app/src/components/posts/post-card.tsx`, `comment-item` in `apps/client_app/src/components/comments/comment-item.tsx`, `comment-replies` on the reply container in the same file, `message-bubble` in `apps/client_app/src/components/chat/message-bubble.tsx`
- [ ] T142 [US9] Create `apps/client_app/e2e/auth-feed.spec.ts`: sign up a fresh unique user through the UI (`apps/client_app/src/app/(auth)/signup`), log in (`(auth)/login`), land on the feed, assert the feed renders and no console errors occurred (US9 AS1) (depends on T138–T141)
- [ ] T143 [US9] Create `apps/client_app/e2e/post-image.spec.ts`: logged-in user opens the create-post dialog, attaches `fixtures/image.png`, submits; the new `feed-item` appears with an `img` whose `naturalWidth > 0` (exercises the B5 upload flow, US9 AS2) (depends on T138–T141)
- [ ] T144 [US9] Create `apps/client_app/e2e/comments.spec.ts`: on a post created via the API, add a comment, then reply to it; assert the reply is inside that comment's `comment-replies` container (US9 AS3) (depends on T138–T141)
- [ ] T145 [US9] Create `apps/client_app/e2e/chat.spec.ts`: two browser contexts for users A and B with a direct chat created via the API; A sends a unique message; B, without reloading, sees a `message-bubble` with that text (US9 AS4) (depends on T138–T141)
- [ ] T146 [US9] Run `npm run e2e` three times in a row against the same stack without cleanup; all three must pass (SC-005). Then run `npm run e2e -- --repeat-each=3` as a flakiness check. Force one assertion to fail once to confirm `trace.zip` and a screenshot are kept under `apps/client_app/e2e/.artifacts/`, then revert
- [ ] T147 [P] [US9] Add an "E2E" section to `apps/client_app/README.md` (create if missing): prerequisites (stack + client running), `npm run e2e`, `--repeat-each=3`, `npx playwright show-trace <zip>`; note that a CI job is optional and not part of this feature's gates

**Checkpoint**: The four main flows pass three times in a row against the same stack.

---

## Phase 12: User Story 10 - Coverage reporting and CI for all backend services (Priority: P2) — Batch B9

**Goal**: Core, auth and notifications each enforce 70% lines / 60% branches; CI runs all three unit suites as a matrix and uploads coverage artifacts.

**Independent Test**: `npm run test:cov -w <app>` passes for all three (quickstart §10); a CI run shows three `Unit tests (<app>)` jobs with `coverage-<app>` artifacts.

### Configuration

- [ ] T148 [P] [US10] In the `jest` block of `apps/core_microservice/package.json`: `collectCoverageFrom` = `["**/*.(t|j)s", "!main.ts", "!**/*.module.ts", "!migrations/**", "!**/index.ts", "!**/*.d.ts"]`, `coverageThreshold: { global: { lines: 70, branches: 60 } }`, `coverageReporters: ["text-summary", "lcov", "json-summary"]` (research §14; nothing else excluded)
- [ ] T149 [P] [US10] Same jest changes in `apps/notifications_consumer_microservice/package.json`
- [ ] T150 [P] [US10] Same jest changes in `apps/auth_microservice/package.json`, plus add `"test:cov": "jest --coverage"` and remove the dead `test:e2e` script (its `test/` directory doesn't exist, research F17)
- [ ] T151 [US10] Run `npm run test:cov` for all three services and write the per-file gap list (files below 70% lines, sorted by uncovered lines) into `specs/004-testing-performance/impl/coverage-gaps.md` to drive T152–T158 (depends on T148–T150)

### Auth specs (≈ +15 points)

- [ ] T152 [P] [US10] `apps/auth_microservice/src/services/auth.service.spec.ts` (extend or create): register, login, refresh (valid, revoked, reused, expired), logout (blacklist + `auth:session-revoked` publish), Google OAuth (new user, existing user, linked account) with all ports mocked
- [ ] T153 [P] [US10] `apps/auth_microservice/src/services/users.service.spec.ts` (user creation fires `HttpEventPublisher`, contact lookup) and `apps/auth_microservice/src/infrastructure/jwt/jwt.service.spec.ts` (sign/verify access and refresh, expiry, wrong secret)
- [ ] T154 [P] [US10] Middleware specs: `apps/auth_microservice/src/middleware/auth.middleware.spec.ts` (`requireAuth`: missing, malformed, blacklisted, valid), `internal-token.middleware.spec.ts`, `error-handler.middleware.spec.ts` (each `DomainError` subclass → status, unknown → 500 without leaking), `validate.middleware.spec.ts`
- [ ] T155 [P] [US10] Route specs with supertest on `createApp()` and mocked ports: `apps/auth_microservice/src/routes/auth.routes.spec.ts` (cookie `refresh_token` path `/auth`, `credentials` + CORS from `AUTH_ALLOWED_ORIGINS`, response `{ accessToken, user }` only), `users.routes.spec.ts`, `internal.routes.spec.ts`
- [ ] T156 [P] [US10] Adapter specs with mocked clients: `apps/auth_microservice/src/infrastructure/cache/redis.service.spec.ts`, `apps/auth_microservice/src/infrastructure/events/http-event-publisher.spec.ts` (fire-and-forget, failures logged), `apps/auth_microservice/src/infrastructure/crypto/crypto.service.spec.ts`, `apps/auth_microservice/src/config/env.spec.ts` (fail-fast on missing vars)

### Core specs (≈ +8 points)

- [ ] T157 [P] [US10] Fill the core gaps listed in `coverage-gaps.md`, starting with `apps/core_microservice/src/modules/follows/follows.service.spec.ts`, `apps/core_microservice/src/modules/comments/comments.service.spec.ts`, `apps/core_microservice/src/modules/profile-summary/profile-summary.service.spec.ts`, then repositories/adapters touched in B2–B6 that lack specs (e.g. `apps/core_microservice/src/common/observability/checks/*.spec.ts`, `apps/core_microservice/src/modules/chats/infrastructure/storage/attachment-storage.adapter.spec.ts`)
- [ ] T158 [US10] Re-run `npm run test:cov` for core, auth and notifications until each passes 70% lines and 60% branches without changing the exclusion list (depends on T152–T157)

### CI

- [ ] T159 [US10] Rewrite the `unit-tests` job in `.github/workflows/ci-pipepline.yml` per contracts/perf-tooling.md "CI": `needs` the lint job, `strategy.fail-fast: false`, `matrix.include`: `{ name: core, ws: core_microservice, dir: apps/core_microservice }`, `{ name: auth, ws: auth_microservice, dir: apps/auth_microservice }`, `{ name: notifications, ws: notifications_consumer_microservice, dir: apps/notifications_consumer_microservice }`, `{ name: shared, ws: "@repo/shared", dir: packages/shared }`; `name: Unit tests (${{ matrix.name }})`, steps checkout → setup-node 20 with npm cache → `npm ci` → `npm run build -w @repo/contracts -w @repo/shared` → `npm run test:cov -w ${{ matrix.ws }}` → `actions/upload-artifact@v4` with `if: always()`, `name: coverage-${{ matrix.name }}`, `path: ${{ matrix.dir }}/coverage`
- [ ] T160 [US10] Push the branch and confirm in the CI run: four green `Unit tests (<name>)` jobs (core, auth, notifications, shared), four downloadable `coverage-<name>` artifacts (SC-006); on a throwaway branch, delete one spec to confirm the job fails with `coverage threshold for lines (70%) not met`, then delete the branch

**Checkpoint**: Coverage is enforced and visible for all three backend services.

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across stories and documentation.

- [ ] T161 Run every integration suite together (core: `attachments`, `b14-repos`, `notifications-relay`, `profile-posts`, `realtime`, `social`, `pagination`, `cache`, `uploads`, `observability`; notifications: `notifications`, `observability`) and confirm `npx jest --listTests -c test/jest-e2e.json` in `apps/core_microservice` lists the four new suites (SC-004, US2)
- [ ] T162 [P] Update `AGENTS.md` and `CLAUDE.md`: `redis-cache` service and `CACHE_REDIS_*`, `INTERNAL_API_TOKEN` now required by core, `/health` · `/health/details` · `/metrics` on all services, the two-step upload flow replacing `POST /assets/upload` and `POST /chats/attachments`, feed cursor paging and page-size caps, perf/e2e/coverage commands, the CI matrix, and that `db:seed -w <app> -- --profile perf` exists
- [ ] T163 [P] Propose a PATCH amendment to `.specify/memory/constitution.md` via `/speckit-constitution`: the workflow gate sentence "core unit tests" becomes "unit tests with coverage thresholds for core, auth and notifications" (plan Constitution Check note). The Principle V operational-endpoint clause (MINOR, v1.1.0) was applied separately during `/speckit-analyze` remediation and must be in place before B6 merges
- [ ] T164 Run `npx turbo run lint` and `npx turbo run build` from the repo root (CI's gates); fix any findings (note `lint` runs `eslint --fix`)
- [ ] T165 Walk through `specs/004-testing-performance/quickstart.md` §0–§10 end to end on a fresh `docker compose down -v` stack and fix any step that no longer matches the code
- [ ] T166 Security pass over the new surface: upload sign/confirm ownership checks, presigned POST conditions, content sniffing, internal-token guards on all three services, no parameters in slow-query logs, `PERF_INSTRUMENTATION` production refusal (run `/security-review` on the branch diff)
- [ ] T167 Assemble the PR description: the `comparison.md` table and SC-002 explanations, the `npm run perf` summary, SC-010 upload-memory output, the coverage numbers per service, and links to the EXPLAIN addendum

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; blocks every story.
- **US1 (Phase 3)**: depends on Foundational. **T024 (baseline capture) must finish before any B2–B6 code merges** (FR-003).
- **US2 harness (Phase 4)**: depends on Foundational; runs alongside US1 within B1.
- **US3 → US4 → US5 → US6 → US7 → US8 → US9 → US10**: delivered in this order (FR-041). Each batch leaves all suites green.
- **Polish (Phase 13)**: after all stories.

### User Story Dependencies (technical, beyond the mandated order)

- **US3 (B2)**: needs the US2 helpers (T025–T027) for `pagination.e2e-spec.ts`.
- **US4 (B3)**: needs US3's keyset feed and paged comments/follows (the indexes match those queries) and US1's query counter.
- **US5 (B4)**: needs Foundational `METRICS_REGISTRY`; independent of US4 code.
- **US6 (B5)**: needs `METRICS_REGISTRY` (`uploads_total`); its signed-link reads build on US5's cache adapter (T078).
- **US7 (B6)**: needs the cache client (US5) for the `cache_redis` check; exposes counters registered by US5/US6.
- **US8 (B7)**: needs US1's k6 script, US6's upload flow (`FLOW=current`), US7's `/metrics` (hit ratio, upload memory).
- **US9 (B8)**: needs US3's feed and US6's upload flow in the client.
- **US10 (B9)**: best last, since it measures coverage of everything above.

### Within Each User Story

- Contracts (`packages/contracts`) → build packages → tests written to fail → entities/value objects → repositories/adapters → services → controllers → client → e2e suite → full-suite run.

### Parallel Opportunities

- Setup: T002, T003 in parallel after T001.
- Foundational: T005 alongside T004.
- US1: T009/T010 (specs), T011/T012 (counter + logger), T016 then T017/T018 (seeds), T019 and T022 (report + compare) all parallel.
- US2: T025–T027 parallel.
- US3: T030–T033 (contracts) parallel; T035–T038 parallel; T042–T045 (DTO caps) parallel; client T048–T050 parallel.
- US4: T058, T062, T063, T064 parallel.
- US5: T069, T070, T072, T073 parallel.
- US6: T082, T083 parallel; T084–T086 (specs) parallel; T090, T092, T093 parallel; T099 alongside server work.
- US7: T105–T109 (shared) parallel; T111, T115, T117 (per service) parallel; T119/T120 parallel; T122/T123/T125 parallel.
- US8: T127, T128, T133, T134 parallel.
- US9: T139–T141 parallel; the four spec files touch different files but share fixtures, so write them after T139–T141.
- US10: T148–T150 parallel; T152–T157 parallel.

---

## Parallel Example: User Story 3

```bash
# Contracts together:
Task: "Create packages/contracts/src/common/pagination.ts (PAGE_SIZE_MAX, CHANGES_PAGE_SIZE_MAX, IOffsetPage)"
Task: "Add IFeedQuery / IFeedPage to packages/contracts/src/posts/{requests,responses}.ts"
Task: "Add IFollowListQuery / IFollowListItem to packages/contracts/src/follows/"
Task: "Create packages/contracts/src/comments/requests.ts with IListCommentsQuery"

# After the contracts build, DTO caps together:
Task: "Cap search-query.dto.ts and posts-by-author-query.dto.ts at PAGE_SIZE_MAX"
Task: "Cap search-profiles-query.dto.ts at PAGE_SIZE_MAX"
Task: "Cap chats list/messages/changes DTOs (50/50/200)"
Task: "Cap the notifications list DTO at PAGE_SIZE_MAX"
```

## Parallel Example: User Story 7

```bash
Task: "health-runner.ts + spec in packages/shared/src/observability/"
Task: "internal-token.ts + spec in packages/shared/src/observability/"
Task: "http-metrics.middleware.ts + spec in packages/shared/src/observability/"
Task: "db-pool.metrics.ts in packages/shared/src/observability/"
# then, per service in parallel:
Task: "Core checks in apps/core_microservice/src/common/observability/checks/"
Task: "Notifications observability module in apps/notifications_consumer_microservice/src/common/observability/"
Task: "Auth health checks + routes in apps/auth_microservice/src/app.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup + Phase 2 Foundational.
2. Phase 3 US1 → capture `reports/baseline.json` (T024).
3. **STOP and VALIDATE**: repeatability within 20%; the report has all six endpoints.
4. Phase 4 US2 harness and green existing suites close B1.

The MVP is the evidence baseline: every later claim in the PR is measured against it, and it must exist before any optimization merges.

### Incremental Delivery (one batch per `/impl-batch` run, `/clear` between)

1. B1: Setup + Foundational + US1 + US2 harness → baseline committed.
2. B2: US3 → caps and cursor feed live, client updated.
3. B3: US4 → indexes and slow-query log; EXPLAIN evidence.
4. B4: US5 → cache with fail-open.
5. B5: US6 → direct uploads; old endpoints removed.
6. B6: US7 → health and metrics in all services.
7. B7: US8 → perf gate green; `final.json` + comparison table.
8. B8: US9 → Playwright flows.
9. B9: US10 → coverage gates and CI matrix.
10. Polish → PR.

### Risks carried from plan.md

- B9 is real test-writing (core 61.9/59.8, auth 55.4/58.2 today), not configuration.
- If an endpoint misses its threshold after B3–B4, record it in `comparison.md` (SC-002) instead of loosening the threshold.
- Follower/following and comments paging (T046, T047, T049, T050) is scope the spec didn't list but FR-007 requires.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps each task to its user story for traceability.
- Commit after each task or logical group; never add Claude co-author lines.
- Follow-up, not in scope: the notifications cursor tie-breaker (research F6) unless B2 has time (T057 records the decision).
- Pinned versions (`grafana/k6`, `@playwright/test`, `prom/prometheus`, `grafana/grafana`, `@aws-sdk/s3-presigned-post`) are recorded at install time in the task that adds them.
