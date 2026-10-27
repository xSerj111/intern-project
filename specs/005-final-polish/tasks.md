---
description: "Task list for the final feature: docs, deployment, observability, env management, cleanup"
---

# Tasks: Final polish (docs, deployment, observability, env, cleanup)

**Input**: [plan.md](./plan.md). It holds the audit ("what is implemented and what is not") and the approved 8-phase plan. There is no spec.md: this feature was planned directly, not through spec-kit.

**Commit prefix**: `feat(INO-12)`

**Acceptance criteria** (the spec item):
- [ ] All documentation is complete and accurate
- [ ] Deployment guides are working
- [ ] Monitoring and logging are configured
- [ ] Environment management is proper

## Format: `[ID] [tags] Description`

- **[P]**: can run in parallel with the other `[P]` tasks of the same wave (different files)
- **[opus] / [sonnet] / [haiku]**: model hint for the lane. Missing hint → sonnet
- **[orch]**: the orchestrator does it itself (install, package build, one-line registrations, small shared-file edits)
- **[gate]**: covered by the batch gate; marked when the gate passes
- **[evidence]**: needs running services; the result goes in `specs/005-final-polish/impl/run/<batch>-evidence.md`
- **[human]**: only the user can do it (browser check, CI push, a decision). Never done or marked by the orchestrator or a lane
- Paths are relative to the repo root

## Batch mapping

| Batch | Title | Tasks | Mode |
|-------|-------|-------|------|
| B1 | Cleanup and CI hygiene | T001–T011 | lanes |
| B2 | Environment management | T012–T019 | lanes |
| B3 | Logging and error tracking | T020–T030 | lanes |
| B4 | Monitoring | T031–T038 | lanes |
| B5 | Docker, deployment and CD | T039–T051 | solo |
| B6 | API documentation (Swagger) | T052–T063 | lanes |
| B7 | Documentation | T064–T078 | lanes |
| B8 | Final review and verification | T079–T084 | solo |

**Mode**: `lanes` = the orchestrator dispatches `task-implementer` lanes. `solo` = the orchestrator implements the code tasks itself, in the main session (tasks tagged with a model may still go to a lane; everything else is the orchestrator's).

## Ground rules for every task

- Read `DDD_ARCHITECTURE_GUIDE.md` (only the section you need) before touching core. `modules/profiles` is the reference layout. Domain code throws `DomainError` subclasses, never `HttpException`.
- Behaviour must not change unless the task says so. Every existing unit and e2e suite must still pass.
- `@repo/shared` is backend-only; `@repo/contracts` is the only package the client imports.
- After changing `packages/shared` or `packages/contracts`, the orchestrator runs `npm run build -w @repo/contracts -w @repo/shared` before apps are built or tested.
- New env vars: read them through the app's typed config (`AppConfigService` in core/notifications, `config/env.ts` in auth), never `process.env` in feature code. Add them to `.env.example` in the same batch.
- Logs never contain secrets, tokens, cookies or request bodies. Metric labels are bounded (route templates, class names, queue names), never raw URLs or IDs.
- Docs describe the code as it is after this feature. Every command a doc gives must exist in a `package.json` or compose file; every env var must exist in the code.
- Never run `npm run lint` (it runs `--fix`). Use `npx eslint <files>` or, after B1, `npm run lint:check`.
- Never `docker compose down -v` the default project (it holds the user's dev data). Deployment checks use a separate project name (`-p innogram-verify`).
- Commit messages carry no Co-Authored-By/Claude line.
- Prettier: `singleQuote: true`, `trailingComma: "all"`.

---

## Phase 1: Cleanup and CI hygiene — Batch B1

- [X] T001 [sonnet] Root `package.json` cleanup. Remove `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `eslint@^8`, `@typescript-eslint/eslint-plugin@^6`, `@typescript-eslint/parser@^6`, and `eslint-config-prettier`/`eslint-plugin-prettier` if no app's `eslint.config.mjs` resolves them from the root. For each root runtime `dependency` (`@nestjs/*`, `pg`, `dotenv`, `reflect-metadata`, `tsconfig-paths`, `@nestjs/mapped-types`): `grep` which workspaces import it; add it to each such workspace's own `package.json` if missing (same version range), then remove it from the root. Keep root tools that root scripts use (`turbo`, `typescript`, `dotenv-cli`, `@types/*`). Delete the root `.eslintrc.json`. Put the before/after dependency table in your Notes file. The orchestrator runs `npm install` afterwards (T009)
- [X] T002 [P] [haiku] Delete the tracked `apps/auth_microservice/data-source.js`, `apps/core_microservice/data-source.js`, `apps/notifications_consumer_microservice/data-source.js` (first confirm with `grep -rn 'data-source.js' apps/*/package.json apps/*/src` that nothing references them) and the per-app lockfiles `apps/*/package-lock.json` (`git rm`). Add `apps/*/package-lock.json` and `packages/*/package-lock.json` to the root `.gitignore`
- [X] T003 [P] [haiku] Fix `apps/core_microservice/tsconfig.json` `paths`: `../shared/src` → `../../packages/shared/src` (check every entry in `paths`; check `apps/notifications_consumer_microservice/tsconfig.json` and `apps/auth_microservice/tsconfig.json` for the same mistake). Done-check: `npx tsc --noEmit -p apps/core_microservice/tsconfig.json`
- [X] T004 [P] [haiku] Code-comment cleanup in `apps/*/src` and `packages/*/src`, except `apps/core_microservice/src/modules/internal-events/` (T005 owns it): remove the commented-out `@Index` in `apps/core_microservice/src/modules/follows/domain/entities/follow.entity.ts` (already covered by `@Unique`), the "Types/Enums (we will add these later)" line in `packages/shared/src/index.ts`, and any other commented-out code blocks. Translate Polish comments to English (`grep -rnP '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]' apps/*/src packages/*/src`, also numbered Polish comments in `apps/core_microservice/src/main.ts`, `apps/auth_microservice/src/main.ts`, `apps/auth_microservice/src/infrastructure/events/http-event-publisher.ts`, `packages/shared/src/logger/logger.module.ts`). Fix the "recieved" typo in `apps/auth_microservice/src/main.ts`. Comments only: no code changes. Do not touch `main.ts` lines that T007 changes (`console.log` in core `main.ts`); coordinate by leaving that line as is
- [X] T005 [opus] Guard `POST /internal/events/user-created`. In `apps/core_microservice/src/modules/internal-events/internal-events.controller.ts` add `@UseGuards(InternalTokenGuard)` (`apps/core_microservice/src/common/observability/internal-token.guard.ts`; make it injectable from `internal-events.module.ts`, importing or exporting what is needed). Replace the Polish comment and remove the commented-out future calls. Update every core e2e spec that calls this endpoint to send `internalTokenHeader()` (`apps/core_microservice/test/helpers`), and add e2e cases: no token → 401 (or what the guard returns for `/metrics`; same behaviour), wrong token → same, valid token → 200 and the profile exists. Done-check also boots the app: run the internal-events e2e suite (or the one that covers it)
- [X] T006 [opus] Auth sends the token. `apps/auth_microservice/src/infrastructure/events/http-event-publisher.ts` adds the `X-Internal-Token` header (`INTERNAL_TOKEN_HEADER` from `@repo/shared`) with `INTERNAL_API_TOKEN` from `apps/auth_microservice/src/config/env.ts`, passed in through the constructor from `createApp()` in `apps/auth_microservice/src/app.ts` (manual DI; keep the fire-and-forget semantics). Mind the `src/...` import paths in this file (CLAUDE.md gotcha). Extend or create `http-event-publisher.spec.ts`: the header is sent with the configured token and is never logged
- [X] T007 [haiku] Replace stray console calls with the logger: `apps/core_microservice/src/main.ts` (`console.log('Core microservice runs on …')` → the Winston logger already created in `bootstrap()`), and `apps/auth_microservice/src/middleware/error-handler.middleware.ts` (`console.error('Unhandled Server Error:', err)` → the app's logger; follow how other auth middleware gets the logger, e.g. a factory `createErrorHandler(logger)` wired in `app.ts`; log message + stack, not the raw object). Update `error-handler.middleware.spec.ts` if it exists
- [X] T008 [haiku] Scripts. Add `"lint:check"` to `apps/{auth_microservice,core_microservice,notifications_consumer_microservice,client_app}/package.json` (same glob as `lint`, without `--fix`). Add `"type-check": "tsc --noEmit"` to `apps/core_microservice`, `apps/notifications_consumer_microservice`, `packages/shared`, `packages/contracts` (use `-p` with the tsconfig that covers `src` and `test`; it must pass now). Add `"db:migrate": "npm run migration:run"` to the three backends. `packages/shared/package.json` jest config: add `"coverageDirectory": "../coverage"` like the 3 apps (with `rootDir: src` it currently writes to `packages/shared/src/coverage/`, so the CI artifact `packages/shared/coverage` is empty); delete the stray `packages/shared/src/coverage/`. Root `package.json`: add `"lint:check": "turbo run lint:check"`. `turbo.json`: add `"lint:check": { "dependsOn": ["^build"] }`, and `"dependsOn": ["^build"]` to `lint`. Run each new `type-check` and `lint:check` once; report failures under Needs instead of fixing other files
- [X] T009 [orch] `npm install` at the root after T001/T002/T008 (refreshes `package-lock.json`); rebuild `@repo/contracts` and `@repo/shared`. Diff the resolved versions in the root lock (`git diff package-lock.json`); record any major-version change in the Notes file and stop for a decision before T010 if one appears
- [X] T010 [haiku] CI. `git mv .github/workflows/ci-pipepline.yml .github/workflows/ci.yml`. In it: lint step → `npx turbo run lint:check`; add a `npx turbo run type-check` step after build. Update the filename everywhere it is referenced in living docs: `AGENTS.md`, `CLAUDE.md`, `DDD_ARCHITECTURE_GUIDE.md`, `.specify/memory/constitution.md` (leave `specs/004-*` history untouched). Also document `lint:check`/`type-check` in the `AGENTS.md` Commands section (replace the "`npm run type-check` is incomplete" note)
- [X] T011 [gate] `npx turbo run build type-check lint:check` passes; `npm run test:cov -w core_microservice -w auth_microservice -w notifications_consumer_microservice -w @repo/shared` passes with thresholds; core e2e (internal-events and the suites T005 touched) passes

**Checkpoint**: No dead config or deps remain, CI lints without mutating files, the internal event endpoint is token-guarded on both sides.

---

## Phase 2: Environment management — Batch B2

- [X] T012 [P] [sonnet] Core env validation. Create `apps/core_microservice/src/config/env.validation.ts`: a `class-validator` `EnvironmentVariables` class and `validate(config)` (`plainToInstance` with implicit conversion, `validateSync`, throw one `Error` listing every failing var). Derive the rules from `apps/core_microservice/src/config/app-config.service.ts`: a key read with no default is required; a key with a default is optional with type/range checks (ports 1–65535, positive ints, `INTERNAL_API_TOKEN` ≥ 32 chars, `NODE_ENV` in development|test|production). Wire it as `ConfigModule.forRoot({ …, validate })` in `apps/core_microservice/src/app.module.ts`. In `AppConfigService`, replace `getOrThrow(key, default)` with `get(key, default)` (and plain `getOrThrow(key)` for required keys). Route the direct reads through `AppConfigService`: `process.env.CLIENT_URL` in `apps/core_microservice/src/main.ts` and `apps/core_microservice/src/modules/chats/**/chats.gateway.ts`, the `JWT_*` reads in `apps/core_microservice/src/common/auth/access-token-verifier.provider.ts` (drop the `JWT_ACCESS_SECRET` alias unless something else sets it; list the decision under Judgment calls). Keep `assertSafeForEnvironment()`/`assertInternalApiToken()` behaviour. Add `env.validation.spec.ts` (missing required → error names the var; bad port → error; valid → passes). Test env: every unit spec and e2e suite that boots `AppModule` must still pass under validation; if any lacks required vars, add a test env fixture (a jest `setupFiles` entry for unit and e2e configs that sets the required vars without overriding real ones). Done-check boots the app via one e2e suite and runs `test:cov`
- [X] T013 [P] [sonnet] Notifications env validation, same pattern as T012: `apps/notifications_consumer_microservice/src/config/env.validation.ts` + spec, wired in `apps/notifications_consumer_microservice/src/app.module.ts`, `AppConfigService` getters cleaned up. Required at startup: everything without a default, including SMTP settings without defaults, `AUTH_INTERNAL_URL`, `CLIENT_URL`, `RABBITMQ_URL`, `INTERNAL_API_TOKEN` (≥ 32; the `onModuleInit` check may stay as a second line of defence). Same test env fixture rule as T012. Done-check boots the app via one e2e suite and runs `test:cov`
- [X] T014 [P] [sonnet] Auth production guard in `apps/auth_microservice/src/config/env.ts`: when `NODE_ENV=production`, `JWT_SECRET` and `JWT_REFRESH_SECRET` are required (no fallback), must be ≥ 32 chars and must not equal the `.env.example` placeholder values; throw with the var name (never the value). Outside production keep today's defaults. Extend `apps/auth_microservice/src/config/env.spec.ts` for each case
- [X] T015 [P] [haiku] Client config. `apps/client_app/src/lib/config.ts`: use `||` instead of `??` for the service URLs so an empty string falls back to localhost. `apps/client_app/next.config.ts`: for each server var it maps to `NEXT_PUBLIC_*` (`AUTH_SERVICE_URL`, `CORE_SERVICE_URL` or whatever names it uses, `NOTIFICATIONS_SERVICE_URL`), throw during a production build (`NODE_ENV=production`) if unset, `console.warn` otherwise. Done-check: `npm run type-check -w client_app`
- [X] T016 [haiku] `.env.example` rewrite (wave 2, after T012–T014 settle names). Group by section (shared infra, core, auth, notifications, client, compose-only, monitoring) with a one-line comment per var saying required/optional and the default. Add `CORE_PORT=3001`, `AUTH_PORT=3002`, `NOTIFICATIONS_PORT=3003`, `OUTBOX_MAX_ATTEMPTS=10` (commented default). Remove `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` (unused; `grep` again first). Keep every var the code reads; cross-check with `grep -rhoE "(process\.env\.|get(OrThrow)?(<[^>]*>)?\\(['\"])[A-Z_]+" apps/*/src packages/*/src apps/client_app/next.config.ts`. Put the var list and diff summary in the Notes file
- [X] T017 [gate] Builds, `type-check`, `lint:check`, unit tests with coverage for the 3 backends + shared, core and notifications e2e pass
- [X] T018 [evidence] Boot checks against real processes: core with `INTERNAL_API_TOKEN` unset exits non-zero naming the var; notifications with `AUTH_INTERNAL_URL` unset exits non-zero naming the var; auth with `NODE_ENV=production` and the placeholder `JWT_SECRET` refuses to start naming the var. Use `scripts/impl-services.sh` conventions; record commands and the first error line
- [X] T019 [orch] Add a "Global decisions" line to progress.md with the final names of required vars (later batches and B7 docs rely on it)

**Checkpoint**: Every backend fails fast at startup on bad config; `.env.example` matches what the code reads.

---

## Phase 3: Logging and error tracking — Batch B3

- [ ] T020 [opus] Shared request context. Create `packages/shared/src/observability/request-context.ts`: `AsyncLocalStorage<{ requestId: string }>`, `runWithRequestContext(requestId, fn)`, `currentRequestId(): string | undefined`, `REQUEST_ID_HEADER = 'x-request-id'`, `CORRELATION_ID_HEADER = 'x-correlation-id'` (AMQP), `requestIdMiddleware()` (Express-compatible: accept an incoming `X-Request-Id` matching `^[A-Za-z0-9._-]{1,128}$`, else `randomUUID()`; set the response header; run `next()` inside the context) and `accessLogMiddleware(logger)` (one log line per response on `finish`: method, route template the same way `http-metrics.middleware.ts` derives it, status, `durationMs`; info below 500, error for 5xx; skip `/health`, `/health/details`, `/metrics`; never log query strings, bodies or headers). Export from `packages/shared/src/observability/index.ts`. Spec: id accepted/regenerated, header echoed, context visible inside `next()` and async continuations, access log skips health
- [ ] T021 [opus] Shared logger and errors. `packages/shared/src/logger/winston.logger.ts`: level from `LOG_LEVEL` (valid `LogLevel` values; invalid → default plus one warning), default `info` when `NODE_ENV=production`, `debug` otherwise; fill `correlationId` from `currentRequestId()` when the caller doesn't pass one (JSON output carries `correlationId`). Create `packages/shared/src/observability/error-metrics.ts`: `createErrorsCounter(registry)` → `errors_total{source,type}` (`source` = `http` | `amqp` | `process`; `type` = error class name; get-or-create so double registration is safe). `packages/shared/src/filters/domain-exception.filter.ts`: optional counter in the constructor, increments with `source=http`. Process errors: reconcile with the existing `ensureProcessHandlers` in `winston.logger.ts`: one mechanism that logs `uncaughtException`/`unhandledRejection` as JSON with stack and exits 1; no double logging. Specs for each. Same lane as T020 (one shared lane, wave 1)
- [ ] T022 [orch] Build `@repo/contracts` and `@repo/shared` after wave 1
- [ ] T023 [P] [sonnet] Core HTTP wiring (wave 2). `apps/core_microservice/src/main.ts`: register `requestIdMiddleware()` first, then `accessLogMiddleware(logger)`, before the existing HTTP-metrics middleware; pass an errors counter from `METRICS_REGISTRY` to `DomainExceptionFilter`. Socket.IO: none. e2e: a request with `X-Request-Id: e2e-123` gets the same header back; a request without one gets a UUID
- [ ] T024 [P] [opus] Core AMQP correlation (wave 2). Outbox entity (find it via `grep -rn 'outbox' apps/core_microservice/src --include=*.ts -il`): nullable `correlation_id` column plus a migration in `apps/core_microservice/src/migrations/`; when an event is written, store `currentRequestId()`. `apps/core_microservice/src/common/messaging/outbox-relay.ts` and `amqp-event-bus.ts`: publish with `headers['x-correlation-id']` when set. `apps/core_microservice/src/modules/notifications-relay/notifications-relay.consumer.ts`: run each handler inside `runWithRequestContext(header ?? randomUUID(), …)`; failures increment `errors_total{source="amqp"}`. Specs for the relay and consumer; the outbox e2e (or messaging e2e) covers the new column against Postgres. Orchestrator runs `migration:run` after this lane
- [ ] T025 [P] [sonnet] Notifications wiring (wave 2). `apps/notifications_consumer_microservice/src/main.ts`: request-id + access-log middleware, errors counter into `DomainExceptionFilter`. `apps/notifications_consumer_microservice/src/common/messaging/amqp-consumer-host.ts`: each handler runs in `runWithRequestContext(header ?? randomUUID(), …)`; handler failures increment `errors_total{source="amqp"}`. `amqp-event-bus.adapter.ts`: forward the current id as `headers['x-correlation-id']` on `notification.created`/`notification.seen`. Specs
- [ ] T026 [P] [sonnet] Auth wiring (wave 2). `apps/auth_microservice/src/app.ts`: request-id + access-log middleware on the public app and the internal app (`createInternalApp`); errors counter from auth's metrics registry. `apps/auth_microservice/src/middleware/error-handler.middleware.ts`: body-parser parse errors (`err.type === 'entity.parse.failed'`) → 400 `{ message: 'Malformed JSON body' }`; count non-domain errors with `source=http`. Specs (malformed JSON → 400; unknown error → 500 + counter)
- [ ] T027 [P] [haiku] Client error boundaries: `apps/client_app/src/app/error.tsx` (`'use client'`, message + "Try again" calling `reset()`, `console.error(error)` in `useEffect`) and `apps/client_app/src/app/global-error.tsx` (own `<html><body>`, same content). Follow the look of `apps/client_app/src/app/not-found.tsx`. Done-check: `npm run type-check -w client_app`
- [ ] T028 [orch] `.env.example`: add `LOG_LEVEL` (commented, "debug|info|warn|error; default info in production, debug otherwise")
- [ ] T029 [gate] Builds, type-check, lint:check, unit tests with coverage, core e2e, notifications e2e, `migration:run` for core
- [ ] T030 [evidence] With core, auth and notifications running: send a request that writes an outbox event (e.g. follow a user) with `X-Request-Id: evidence-b3`; show the id in core's access log, on the AMQP message headers (or the notifications consumer log line) and in the notifications log for the resulting notification. Also show a malformed JSON body to auth returns 400

**Checkpoint**: Every log line of a request carries its id across HTTP and RabbitMQ; errors are counted by source and type.

---

## Phase 4: Monitoring — Batch B4

- [ ] T031 [P] [sonnet] Shared AMQP metrics (wave 1). `packages/shared/src/observability/amqp-metrics.ts`: `createAmqpMetrics(registry)` → `amqp_messages_total{queue,outcome}` (`ack` | `retry` | `dlq` | `drop`) and `amqp_handler_duration_seconds{queue}` histogram; get-or-create. Export + spec
- [ ] T032 [P] [sonnet] Outbox metrics (wave 1). `apps/core_microservice/src/common/messaging/outbox-relay.ts` via `METRICS_REGISTRY`: `outbox_published_total`, `outbox_failed_total`, `outbox_dead_total` (attempts reached `OUTBOX_MAX_ATTEMPTS`) counters; `outbox_pending` and `outbox_oldest_pending_seconds` gauges updated by the relay's poll loop (one cheap aggregate query per poll; no `collect()` callback that hits the DB on every scrape). Spec
- [ ] T033 [orch] Build `@repo/shared` after wave 1
- [ ] T034 [P] [sonnet] Consumer metrics (wave 2) using T031 in `apps/notifications_consumer_microservice/src/common/messaging/amqp-consumer-host.ts` and `apps/core_microservice/src/modules/notifications-relay/notifications-relay.consumer.ts`: outcome per message, handler duration. Specs
- [ ] T035 [P] [sonnet] Monitoring stack (wave 1). In `docker/monitoring/`:
  - `alerts.yml` with groups for `ServiceDown` (`up == 0` for 1m), `High5xxRate` (5xx share > 5% for 5m, using `status_class="5xx"`), `HighP95Latency` (p95 > 500 ms for 10m), `OutboxBacklog` (`outbox_oldest_pending_seconds > 300`), `OutboxDead` (increase of `outbox_dead_total` > 0), `AmqpDlqGrowth` (increase of `amqp_messages_total{outcome="dlq"}` > 0 over 15m), `DbPoolSaturated` (`db_pool_connections{state="waiting"} > 0` for 5m). Each has `severity` and `summary`.
  - Wire it through `rule_files` in `prometheus.yml`, and mount it in `docker-compose.yml`.
  - Make the scrape targets configurable: `entrypoint.sh` writes a `file_sd` JSON from `PROMETHEUS_TARGETS` (default `host.docker.internal:3001,host.docker.internal:3002,host.docker.internal:3003`, with a `service` label per target).
  - `grafana/dashboards/innogram-overview.json`: fix the 5xx panel to filter on `status_class="5xx"`, and add panels for outbox pending/age, AMQP outcomes, handler p95, and `errors_total` by source/type.
  - Compose: `GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:?set GRAFANA_ADMIN_PASSWORD}`.
  - Validate with `docker run --rm --entrypoint promtool -v $PWD/docker/monitoring:/m prom/prometheus:<pinned tag> check rules /m/alerts.yml` and `check config` (the config check needs the file_sd path to exist; use a temp file).
- [ ] T036 [orch] `.env.example`: `GRAFANA_ADMIN_PASSWORD`, `PROMETHEUS_TARGETS` (commented default)
- [ ] T037 [gate] Builds, type-check, lint:check, unit tests with coverage, core and notifications e2e
- [ ] T038 [evidence] `docker compose --profile monitoring up -d prometheus grafana` (no `down` of other services) with core/auth/notifications running: `/api/v1/targets` all UP, `/api/v1/rules` lists the alert groups, `/metrics` on core shows the `outbox_*` and `amqp_*` series. Stop only the core process the script started → `ServiceDown` goes pending; restart it. Record the JSON excerpts

**Checkpoint**: Outbox and consumer health are measurable and alerting rules are loaded.

---

## Phase 5: Docker, deployment and CD — Batch B5 (solo)

- [ ] T039 Root `.dockerignore`: `**/node_modules`, `**/dist`, `**/.next`, `**/coverage`, `**/.turbo`, `.git`, `.env`, `.env.*` with `!.env.example` and `!.env.production.example`, `specs`, `.claude`, `.specify`, `apps/client_app/e2e/.artifacts`, `apps/client_app/playwright-report`, `apps/client_app/test-results`, `apps/core_microservice/test/load/reports`
- [ ] T040 Backend Dockerfiles `apps/{auth_microservice,core_microservice,notifications_consumer_microservice}/Dockerfile`, same pattern (confirm `turbo prune --docker` output layout with the installed turbo version first). Do core first and prove it end to end (image builds, container starts, `/health` 200, `require('@repo/shared')` resolves) before writing auth and notifications: pruned npm lockfiles on turbo 1.13 have known bugs, and if `npm ci` rejects the pruned lock, fall back to copying the root lockfile and stop for a decision:
  - `prune` stage: `npx turbo prune <app> --docker`.
  - `deps` stage: `npm ci` on `out/json` and the pruned lockfile.
  - `build` stage: copy `out/full`, `npx turbo run build --filter=<app>...`.
  - `runner` stage: `node:20-alpine`, `NODE_ENV=production`, `npm ci --omit=dev` from `out/json`; copy the app `dist` and `packages/{shared,contracts}/dist`; `USER node`; `EXPOSE`; `HEALTHCHECK` via `wget -qO- http://127.0.0.1:<port>/health`; `CMD ["node", "dist/main.js"]` from the app dir (check where `nest build` puts `main.js` given `include: ["src/**/*","test/**/*"]`).
  - Each image must start, and `require('@repo/shared')` must resolve.
- [ ] T041 Container migrations. Per backend, `src/migrate.ts`: builds the app's `DataSource` options (reuse the TypeORM options the app already builds; don't duplicate connection logic), `runMigrations({ transaction: 'each' })`, logs the applied names, exits 0/1. It must be compiled into `dist/`, along with the migration files. Fix `apps/auth_microservice/src/config/database.ts` migrations glob to `migrations/*.{ts,js}` (and check core/notifications globs work from `dist`). Add a `migrate:prod` script (`node dist/migrate.js`) to each backend
- [ ] T042 Client image. `apps/client_app/next.config.ts`: `output: 'standalone'` (and `outputFileTracingRoot` at the repo root for the monorepo). `apps/client_app/Dockerfile`: same prune pattern; `ARG AUTH_SERVICE_URL`, `ARG CORE_SERVICE_URL`, `ARG NOTIFICATIONS_SERVICE_URL` (names as in `next.config.ts`) passed to `next build`; runner copies `.next/standalone`, `.next/static`, `public`; `USER node`; `HEALTHCHECK`; `CMD ["node", "apps/client_app/server.js"]` (verify the path standalone produces)
- [ ] T043 Infra hardening in `docker-compose.yml`:
  - Healthchecks: `pg_isready` for postgres, `redis-cli ping` for redis and redis-cache, `rabbitmq-diagnostics -q ping` for rabbitmq, and an HTTP check against the mailpit UI.
  - `restart: unless-stopped` on long-running services.
  - Keep host port mappings for dev unchanged.
- [ ] T044 `docker-compose.apps.yml` overlay:
  - Services: `auth-migrate`, `core-migrate`, `notifications-migrate` (one-shot, `command: ["node","dist/migrate.js"]`), then `auth`, `core`, `notifications`, `client` (built from the Dockerfiles, `env_file: .env.production`).
  - `depends_on`: infra `service_healthy`, the migrate jobs `service_completed_successfully`.
  - Internal hostnames (`postgres`, `redis`, `redis-cache`, `rabbitmq`, `mailpit`, `seaweedfs`, `auth:3012` for `AUTH_INTERNAL_URL`, `http://core:3001` for `CORE_SERVICE_URL`).
  - `AUTH_INTERNAL_HOST=0.0.0.0` with port 3012 never published.
  - Published ports 3000–3003.
  - `PROMETHEUS_TARGETS=core:3001,auth:3002,notifications:3003` for the monitoring profile.
  - Root scripts: `"docker:apps:up": "docker compose -f docker-compose.yml -f docker-compose.apps.yml up -d --build"`, `"docker:apps:down"` (no `-v`).
- [ ] T045 `.env.production.example`: every var the overlay needs, with container hostnames, `NODE_ENV=production`, `AUTH_INTERNAL_HOST=0.0.0.0`, `AUTH_COOKIE_SAMESITE` guidance, and `CHANGE_ME` placeholders for every secret (`JWT_*`, `INTERNAL_API_TOKEN`, DB/RabbitMQ/S3 creds, `GRAFANA_ADMIN_PASSWORD`). The B2 validation must reject the placeholders in production where the var is a secret. Add `.env.production` to `.gitignore`
- [ ] T046 [sonnet] CD workflow `.github/workflows/docker-images.yml`:
  - Trigger on `pull_request` and on `push` to `main` and to `v*` tags.
  - Matrix over `auth_microservice`, `core_microservice`, `notifications_consumer_microservice`, `client_app` → image `ghcr.io/${{ github.repository_owner }}/innogram-<short>`.
  - Use `docker/setup-buildx-action`, `docker/metadata-action` (tags: `sha`, `latest` on main, semver on tags) and `docker/build-push-action` with `cache-from/to: type=gha,scope=<app>`, plus `docker/login-action` to GHCR with `GITHUB_TOKEN`.
  - `push` only when the event isn't a pull request.
  - `permissions: contents: read, packages: write`.
  - Pin action major versions.
  - Lint with `actionlint` if it is available (`docker run --rm -v $PWD:/repo -w /repo rhysd/actionlint:latest`), otherwise state it wasn't checked.
- [ ] T047 [evidence] Clean deploy run with a separate project, so the user's dev data is untouched:
  - Ask the user first if their dev stack holds ports 3000–3003/5432/… (it must be stopped for this run, or the overlay ports must be overridden).
  - `cp .env.production.example .env.production` with generated secrets.
  - `docker compose -p innogram-verify -f docker-compose.yml -f docker-compose.apps.yml up -d --build`.
  - Confirm: all services healthy, the migrate jobs exit 0, `curl` `/health` 200 on 3001/3002/3003, the client serves `/` on 3000, `docker compose -p innogram-verify exec core id` shows a non-root uid, and image sizes are recorded.
  - Tear down with `docker compose -p innogram-verify … down -v` (this project only).
- [ ] T048 [evidence] Playwright `npm run e2e` against the `innogram-verify` stack (before teardown in T047, or bring it up again). Record pass/fail counts
- [ ] T049 [gate] Builds, type-check, lint:check, unit tests with coverage, core and notifications e2e on the dev stack
- [ ] T050 [human] Push the branch / open the PR: the `docker-images` workflow builds all 4 images without pushing; after merge, the images appear in GHCR
- [ ] T051 [orch] Add a progress.md Global decision with the exact deploy commands and image names (B7 docs use them verbatim)

**Checkpoint**: A clean machine with Docker runs the whole stack from two compose files and one env file; images are built in CI.

---

## Phase 6: API documentation (Swagger) — Batch B6

- [ ] T052 [P] [sonnet] Core Swagger setup.
  - `apps/core_microservice/src/main.ts`: `addBearerAuth()`, one tag per controller with consistent capitalisation (`Profiles`, `Posts`, `Comments`, `Follows`, `Likes`, `Chats`, `Uploads`), fix the "3002" comment, and serve Swagger only when `SWAGGER_ENABLED` is true. The default is true unless `NODE_ENV=production`; add the var to `app-config.service.ts` and `env.validation.ts`.
  - Rename `@ApiTags('chats')` → `'Chats'` in `apps/core_microservice/src/modules/chats/*.controller.ts` (only the tag line).
  - Add `@ApiExcludeController()` to `apps/core_microservice/src/common/observability/health.controller.ts` and `metrics.controller.ts`.
- [ ] T053 [P] [sonnet] Core posts and comments docs. `apps/core_microservice/src/modules/posts/posts.controller.ts` (9 routes) and `apps/core_microservice/src/modules/comments/comments.controller.ts` (4 routes) get `@ApiTags`, `@ApiBearerAuth` where guarded, `@ApiOperation({ summary })`, a typed 2xx response, and 400/401/403/404 where they apply. Follow `apps/core_microservice/src/modules/chats/chats.controller.ts`. Create response DTO classes with `@ApiProperty` where none exist (`modules/posts/dto/*-response.dto.ts`, `modules/comments/dto/*-response.dto.ts`), implementing the matching `@repo/contracts` interface. No runtime behaviour change: the DTO classes are for documentation unless the controller already maps to them
- [ ] T054 [P] [sonnet] Core profiles, profile-summary and follows docs: response types for every route in `apps/core_microservice/src/modules/profiles/profiles.controller.ts`, `apps/core_microservice/src/modules/profile-summary/profile-summary.controller.ts` and `apps/core_microservice/src/modules/follows/follows.controller.ts`; `@ApiBearerAuth` on follows' guarded routes; error responses as in T053
- [ ] T055 [P] [sonnet] Notifications docs: `@ApiProperty`/`@ApiPropertyOptional` on every DTO under `apps/notifications_consumer_microservice/src/modules/*/dto/` (list-notifications-query, mark-seen, update-preferences, notification-response page and unseen-count, preferences-response, notification-cursor), and the `SWAGGER_ENABLED` gate in its `main.ts` + config + `env.validation.ts`
- [ ] T056 [P] [opus] Auth OpenAPI. `tsconfig` has `removeComments: true`, so the `@openapi` JSDoc never reaches `dist/`.
  - Replace swagger-jsdoc with a typed OpenAPI 3 object in `apps/auth_microservice/src/config/openapi.ts`, covering every public route in `src/routes/*.ts` plus `GET /health`.
  - Give it component schemas for request/response bodies (login, register, google, me, refresh, logout, error), `bearerAuth`, and a `refreshCookie` (`apiKey` in cookie `refresh_token`) security scheme.
  - Take `servers` from the auth public URL/port in `config/env.ts`.
  - Serve it from `apps/auth_microservice/src/config/swagger.ts` behind `SWAGGER_ENABLED` (same default rule), and remove the JSDoc blocks from the route files.
  - Drop `swagger-jsdoc` from `package.json` if unused (orchestrator installs).
  - Unit spec: every route registered on the public router has a path in the document.
- [ ] T057 [P] [haiku] Fix the `password` `@ApiProperty` description in `packages/shared/src/dtos/auth/create-user.dto.ts`; check the other shared DTOs for copy-paste descriptions
- [ ] T058 [P] [haiku] `docs/realtime.md`: the `/realtime` Socket.IO contract (connect + auth, rooms, every client→server and server→client event with payload fields, ordering/ack rules), with `packages/contracts/src/realtime/events.ts` as the source of truth. Start from `specs/003-realtime-chat/contracts/realtime-socket.md`; include `deletedAt` on `message:deleted`; list notification events relayed from notifications
- [ ] T059 [orch] `npm install` if T056 changed deps; build `@repo/shared`; `.env.example`: `SWAGGER_ENABLED` (commented, "default true unless NODE_ENV=production")
- [ ] T060 [sonnet] OpenAPI coverage tests (wave 2):
  - `apps/core_microservice/test/openapi.e2e-spec.ts` (boot via `createE2eApp`, build the document with the same `DocumentBuilder` config. Extract that config into a small exported function in `main.ts`'s neighbour `src/swagger.ts` so both use it. The core main.ts part goes to this lane in wave 2).
  - `apps/notifications_consumer_microservice/test/openapi.e2e-spec.ts` (same approach).
  - Assert every operation has a `summary`, at least one 2xx response, a response schema unless it is 204, and `security` when the route is guarded.
  - Also assert that `/health`, `/metrics` and `/internal/*` are absent.
- [ ] T061 [gate] Builds, type-check, lint:check, unit tests with coverage, core and notifications e2e (including the openapi specs)
- [ ] T062 [evidence] With the 3 services running: `GET /api-json` (core, notifications) and auth's JSON endpoint; record the path counts, and confirm zero operations without a summary and zero empty schemas
- [ ] T063 [human] Open the 3 Swagger UIs, use Authorize with a real access token, and run one guarded endpoint per service

**Checkpoint**: Every public HTTP endpoint is documented with schemas and auth; a test fails if a new one isn't.

---

## Phase 7: Documentation — Batch B7

All doc lanes read `specs/005-final-polish/impl/progress.md` Global decisions (exact var names, deploy commands, image names) and verify every command and var they write against `package.json` files, compose files and code.

- [ ] T064 [human] Decide the LICENSE holder and year (the root README claims MIT). The orchestrator asks at batch start; T077 depends on the answer
- [ ] T065 [P] [sonnet] Root `README.md` rewrite:
  - What Innogram is, and a mermaid architecture diagram (client, auth, core, notifications, Postgres ×3 DBs, Redis ×2, RabbitMQ, SeaweedFS, Mailpit).
  - Prerequisites (Node 20, Docker), a local quick start (`cp .env.example .env`, `npm ci`, `npm run docker:up`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`).
  - A ports & URLs table (apps, Swagger, Mailpit UI, RabbitMQ UI, Grafana, Prometheus).
  - A scripts table covering every root script, including `lint` mutating vs `lint:check`.
  - Links to `docs/*`, `DDD_ARCHITECTURE_GUIDE.md`, `CONTRIBUTING.md` and the per-service READMEs.
  - Remove the stale claims (`packages/types`, NestJS auth, API gateway, Node 18).
- [ ] T066 [P] [sonnet] `docs/DEPLOYMENT.md`, from the B5 Global decisions:
  - Images and where CI publishes them; building locally. The client image bakes `NEXT_PUBLIC_*` in at build time, so the published client image only works for the compose default URLs; other environments rebuild it with their own build args.
  - `.env.production` from `.env.production.example` and how to generate secrets.
  - `docker:apps:up` and what starts in which order (migrate jobs first); upgrading; rollback (image tag pinning; migrations are forward-only unless reverted with `migration:revert`).
  - Reverse proxy/TLS notes and cookie `SameSite` across sites; port 3012 never public.
  - Scaling limits (single core instance for realtime), backups (Postgres volumes), and a troubleshooting section (unhealthy service → `docker compose logs`, failed migration job, env validation errors).
- [ ] T067 [P] [sonnet] `docs/ENVIRONMENT.md`: a table of every env var with service(s), required/optional, default, and description, plus sections for dev vs production vs test and secret handling. Generated from the code sweep in T016 plus later batches; consistent with `.env.example` and `.env.production.example`
- [ ] T068 [P] [sonnet] `docs/OBSERVABILITY.md`:
  - Health endpoints and the status semantics (`unhealthy` 503 vs `degraded` 200), `/health/details` and `/metrics` with `X-Internal-Token`.
  - The metrics catalogue: HTTP, DB pool, cache, outbox, AMQP, errors, process.
  - Logging: JSON format, `LOG_LEVEL`, request ids over HTTP and RabbitMQ, and how to follow one request across services.
  - The monitoring profile (start, Grafana login, dashboard panels) and the alert catalogue, with a runbook entry per alert. Note that there is no Alertmanager: alerts are visible in the Prometheus UI.
- [ ] T069 [P] [sonnet] `docs/API.md`: per-service Swagger URLs and the `SWAGGER_ENABLED` rule; the auth flow (register/login → access token + httpOnly refresh cookie, `credentials: 'include'`, refresh/logout); conventions (paging and `PAGE_SIZE_MAX`, cursor feed, errors from `DomainExceptionFilter`, two-step uploads); a link to `docs/realtime.md`
- [ ] T070 [P] [sonnet] `apps/core_microservice/README.md` (replace the NestJS boilerplate): purpose, modules table, layering (link the guide), endpoints overview (link Swagger), the env vars it reads (link ENVIRONMENT.md), run/test/e2e/perf/migrations/seed commands, realtime and outbox notes
- [ ] T071 [P] [sonnet] `apps/auth_microservice/README.md` (replace the NestJS boilerplate): Express + manual DI in `createApp()`, routes, the internal listener on 3012, sessions/blacklist in Redis, `auth:session-revoked`, Google OAuth, env, commands
- [ ] T072 [P] [haiku] `apps/notifications_consumer_microservice/README.md`: fix the env note (port vars now in `.env.example`), say `/health` is public, and add the request-id/AMQP correlation and metrics notes
- [ ] T073 [P] [haiku] `apps/client_app/README.md`: dev/build/start, env vars (build-time `NEXT_PUBLIC_*` mapping), Docker image build args, and keep the existing Playwright section
- [ ] T074 [P] [haiku] `packages/shared/README.md` and `packages/contracts/README.md`: purpose, what goes where (the AGENTS.md rule), the import boundary (client never imports shared), build-before-use
- [ ] T075 [P] [sonnet] `CONTRIBUTING.md`: branch naming, commit style (`feat(INO-n): …`), local gates (`build`, `type-check`, `lint:check`, `test:cov`, e2e), DDD conventions (link the guide), adding a migration, adding an env var (config + validation + `.env.example` + ENVIRONMENT.md), PR checklist
- [ ] T076 [sonnet] Agent and architecture docs: update `AGENTS.md`, `CLAUDE.md` and the observability/deployment sections of `DDD_ARCHITECTURE_GUIDE.md` for the new scripts, CI file name, env validation, request ids, new metrics and alerts, the Docker flow, and `db:migrate` now working. Add `profile-summary` to the AGENTS.md module list
- [ ] T077 [haiku] `LICENSE` (MIT) with the holder from T064
- [ ] T078 [evidence] [sonnet] Docs verifier:
  - Follow the root README local quick start on the dev stack (no `down -v`).
  - Check that every command in README, DEPLOYMENT and the service READMEs exists, that every var in ENVIRONMENT.md matches the code sweep and both `.env` examples, and that every relative link resolves (`grep -oE '\]\([^)]+\)'`).
  - Write the findings and fix list to `specs/005-final-polish/impl/run/B7-docs-check.md`. The orchestrator routes the fixes to the owning lanes.

**Checkpoint**: A newcomer can go from clone to running stack, and from stack to production, using only the docs.

---

## Phase 8: Final review and verification — Batch B8 (solo)

- [ ] T079 [orch] `/code-review high` over `main...HEAD` (Skill `code-review`); triage the findings into fix/skip with a reason
- [ ] T080 Fix the confirmed findings (lanes allowed for large ones; same ownership rules)
- [ ] T081 [gate] Full gate from clean installs: `npm ci`, `npx turbo run build type-check lint:check`, `npm run test:cov` for the 3 backends + shared, core e2e, notifications e2e
- [ ] T082 [evidence] Re-run T047 (clean deploy with `-p innogram-verify`) and T048 (Playwright) on the final code
- [ ] T083 [orch] Tick the acceptance criteria at the top of this file with evidence links (`impl/run/*`); write `specs/005-final-polish/impl/pr-description.md` (summary, audit before/after table, how to verify, follow-ups)
- [ ] T084 [human] Push, open the PR, CI (`ci.yml`, `docker-images.yml`) green; after merge, GHCR images published

**Checkpoint**: All four acceptance criteria are ticked with evidence.
