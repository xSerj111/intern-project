# Final feature: docs, deployment, observability, env, cleanup

## Context

This is the last spec item. It asks for complete Swagger docs, accurate READMEs, working deployment guides with Docker, monitoring, logging and error tracking, proper environment management, and a final cleanup. A read-only audit of the repo (3 parallel explorers, with key claims spot-checked) found the runtime plumbing mostly in place. The docs, the deploy path and environment hygiene are weak or broken.

Decisions already made:
- **Deploy target:** a full docker-compose stack plus a CD job that builds images (and pushes to GHCR).
- **Error tracking:** self-hosted only, no SaaS.
- **Workflow:** a direct phased plan, one commit per phase. Commits get no Claude co-author.

## Audit: what is implemented and what is not

| Spec item | Status | Evidence |
|---|---|---|
| **Swagger** | 🟡 Partial | `/api` exists on all 3 backends. In core, `main.ts` has no `addBearerAuth()`, so there is no Authorize button. Posts (9 routes) and Comments (4) have no decorators. Profiles and Follows have no response types. Health and metrics are not hidden. The tag list doesn't match the controllers, and a comment says port 3002. In notifications, the controllers are decorated but the 6 DTOs have no `@ApiProperty`, so schemas render empty. In auth (`config/swagger.ts`), `servers` points at :3001 and the `apis` glob is `./src/routes/*.ts`, which is empty in the Docker image. Health is undocumented and there are no response schemas. There is no Swagger env gate. The `password` description in shared `create-user.dto.ts` is wrong. |
| **READMEs** | 🔴 Mostly missing or stale | The root README is stale: it lists `packages/types`, calls auth NestJS, says `db:migrate`, Node 18, and "API Gateway", leaves out half the infra, links no guide, and claims MIT with no LICENSE file. The core and auth READMEs are NestJS boilerplate. The notifications README is good, apart from small errors. The client_app README covers only E2E. `packages/*` have no README. ✅ `DDD_ARCHITECTURE_GUIDE.md` is current. |
| **Deployment guides** | 🔴 Missing | There is no DEPLOYMENT.md, no CD workflow and no tags. Only bullet notes in `AGENTS.md`. |
| **Docker configuration** | 🔴 Broken | Compose is infra only, with no app services. The runner stage in all 3 Dockerfiles installs only root deps and skips `packages/*/dist`, so it would crash on `require('@repo/shared')`. There is no `.dockerignore`, so the `.env` leaks into the build context. Images run as root, with no HEALTHCHECK. client_app has no Dockerfile. Infra has no healthchecks (except seaweedfs) and no restart policy. Migrations can't run in a container: the CLI is ts-node only, and auth's runtime glob is `migrations/*.ts`. |
| **Monitoring** | 🟢 Mostly done | ✅ prom-client metrics, `/health`, and internal `/health/details` and `/metrics` on all 3. ✅ The Prometheus and Grafana profile, with token auth on scrape and 1 dashboard. ❌ No alert rules. ❌ No outbox or AMQP consumer metrics. ❌ The Grafana "5xx" panel counts 4xx too. ❌ Grafana admin password is the default. |
| **Logging** | 🟡 Partial | ✅ The shared WinstonLogger (JSON in prod) is used in all 3. ❌ Level hardcoded to debug, with no `LOG_LEVEL`. ❌ No request or correlation ID (`LogData.correlationId` is never set). ❌ No access log. ❌ Not propagated over AMQP. ❌ A stray `console.log` (core `main.ts:90`) and `console.error` (auth `error-handler.middleware.ts:21`). |
| **Error tracking** | 🔴 Missing | ✅ Domain filters and Winston's exception and rejection handlers. ❌ No error metric by type, no alerting, and client_app has no `error.tsx` or `global-error.tsx`. ❌ Auth turns a malformed JSON body into a 500. |
| **Environment management** | 🟡 Partial | ✅ One root `.env.example`, and auth validates at startup in `config/env.ts`. ❌ Core and notifications have no `ConfigModule` validation schema; `getOrThrow` with a default never throws. ❌ Auth's JWT secrets fall back to the public placeholder, with no production guard. ❌ `.env.example` is missing the `*_PORT` vars, `OUTBOX_MAX_ATTEMPTS`, `JWT_ACCESS_SECRET` and `LOG_LEVEL`, and lists unused `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL`. ❌ In client_app `src/lib/config.ts`, using `??` with `''` defeats the localhost fallback. ❌ There is no production env template or env reference doc. |
| **Final cleanup** | 🔴 Not done | Covered by Phase 1 below. Lint currently passes with 0 errors. No TODO or FIXME comments. |
| _Bonus finding_ | 🔴 Security | Core's `POST /internal/events/user-created` has no guard, and auth doesn't send `X-Internal-Token`. |

---

## Implementation plan (8 phases, 1 commit each)

Docs come last so they describe the final state.

### Phase 1: Cleanup and CI hygiene
- Delete:
  - The root `.eslintrc.json`, plus the root `eslint@8`, `@typescript-eslint/*@6` and `prisma`/`@prisma/*` dev and deps.
  - The root runtime `dependencies` that belong in workspaces, but only after checking that each workspace declares its own.
  - The tracked `apps/*/data-source.js`.
  - The per-app `package-lock.json` files. Run `npm install` at the root afterwards to refresh the root lock.
  - Do the dependency and lockfile changes as the first step of the phase. Diff the resolved versions in the root lock, then run `npm ci` and the full code gates before touching anything else, so version drift is caught on its own.
- Fix `apps/core_microservice/tsconfig.json` `paths` (`../shared/src` → `../../packages/shared/src`).
- Add `"coverageDirectory": "../coverage"` to the `@repo/shared` jest config, as the 3 apps have. Its `rootDir` is `src`, so coverage is currently written to `packages/shared/src/coverage/`, while CI uploads `packages/shared/coverage`, so that artifact is empty. Delete the stray `src/coverage/`.
- Remove the commented-out code: `internal-events.controller.ts:17-19`, `follow.entity.ts:7` and `packages/shared/src/index.ts:50`. Translate the Polish comments to English, and fix "recieved" in `auth/src/main.ts`.
- Replace the stray console calls with the logger: core `main.ts:90` and auth `error-handler.middleware.ts:21`.
- **Security:** add `InternalTokenGuard` (already in core `common/observability`, uses shared `internal-token.ts`) to `InternalEventsController`. Make auth's `infrastructure/events/http-event-publisher.ts` send `X-Internal-Token`. Add a spec for each side.
- CI:
  - Rename `ci-pipepline.yml` → `ci.yml` and update the references in `AGENTS.md`, `CLAUDE.md`, `DDD_ARCHITECTURE_GUIDE.md` and `.specify/memory/constitution.md`. Historical `specs/004-*` records stay as they are.
  - Add a `lint:check` script (eslint without `--fix`) to each app and use it in CI.
  - Add `"dependsOn": ["^build"]` to `lint` and `type-check` in `turbo.json`. The repo is on turbo 1.13, so keep the v1 `pipeline` key and don't copy v2 (`tasks`) examples.
  - Add `type-check` (`tsc --noEmit`) to core, notifications, shared and contracts, and add a `type-check` step to CI.
  - Make `db:migrate` real: each backend gets `"db:migrate": "npm run migration:run"`, so the root `npm run db:migrate` works.

### Phase 2: Environment management
- Core and notifications: add an `env.validation.ts` built on `class-validator`/`class-transformer`, which are already deps. Wire it in as `ConfigModule.forRoot({ validate })` so required vars fail at startup. Keep the `AppConfigService` getters and remove the misleading `getOrThrow(key, default)`. Route the direct `process.env.CLIENT_URL` reads (`main.ts:42`, `chats.gateway.ts:77`) and the `JWT_*` reads in `access-token-verifier.provider.ts` through the config service.
- Tests: any spec or e2e that boots `AppModule` will fail validation without a full env. In the same phase, add a test env fixture (a jest `setupFiles` entry or a `.env.test` loaded by the test configs) for core and notifications, and confirm `test:cov` and `test:e2e` stay green.
- Auth `config/env.ts`: when `NODE_ENV=production`, reject the placeholder or too-short `JWT_SECRET` and `JWT_REFRESH_SECRET`. Extend `env.spec.ts`.
- client_app:
  - Change `src/lib/config.ts` to use `||`.
  - Add a small validation in `next.config.ts` that warns in dev and throws in a production build.
  - `NEXT_PUBLIC_*` stays build-time and becomes Docker build args in Phase 5.
- `.env.example`:
  - Add `CORE_PORT`, `AUTH_PORT`, `NOTIFICATIONS_PORT`, `OUTBOX_MAX_ATTEMPTS`, `LOG_LEVEL`, `SWAGGER_ENABLED`, `GRAFANA_ADMIN_PASSWORD` and the Docker image build args.
  - Remove the unused Google vars.
  - Group the vars by service, with required/optional comments.
- Add `.env.production.example` with the container hostnames, `AUTH_INTERNAL_HOST=0.0.0.0`, `NODE_ENV=production` and secret placeholders that must be replaced.

### Phase 3: Logging and error tracking (self-hosted)
- `packages/shared/src/logger/winston.logger.ts`: read the level from `LOG_LEVEL`, defaulting to `info` in production and `debug` otherwise.
- New `packages/shared/src/observability/request-context.ts`: an `AsyncLocalStorage` store with a request-ID middleware that reads or creates `X-Request-Id` and echoes it on the response. WinstonLogger fills `correlationId` from the store automatically.
  - Register it in core and notifications `main.ts` and in auth `app.ts`.
  - Also add access logging (method, route, status, duration), reusing the timing pattern in `http-metrics.middleware.ts` and skipping health and metrics.
- AMQP propagation (**first to cut** if time is short; request IDs and access logs over HTTP already cover most of the logging requirement):
  - Core's `common/messaging/amqp-event-bus.ts` and the outbox relay set `headers['x-correlation-id']` (the outbox row needs a nullable `correlation_id` column, added by a migration).
  - Notifications' `amqp-consumer-host.ts` and core's `notifications-relay.consumer.ts` run each handler in a context seeded from that header.
- Error tracking:
  - An `errors_total{source=http|amqp|process,type}` counter (bounded labels: error class names only) in `DomainExceptionFilter`, auth's `errorHandler` and the AMQP consumer failure path.
  - Auth's `errorHandler` maps body-parser `SyntaxError` to 400.
  - Process errors: the shared WinstonLogger already registers `uncaughtException` and `unhandledRejection` handlers once (`ensureProcessHandlers` in `winston.logger.ts`). Extend that hook to increment `errors_total{source="process"}` and make sure the process exits after logging. Don't add a second set of `process.on` handlers, which would double-log or race on exit.
  - client_app gets `src/app/error.tsx` and `src/app/global-error.tsx`.
- Tests: request-context unit spec, logger level spec, consumer correlation spec.

### Phase 4: Monitoring
- Outbox metrics in core `outbox-relay.ts`:
  - `outbox_pending` gauge.
  - `outbox_published_total` and `outbox_failed_total` counters.
  - `outbox_dead_total` counter.
  - `outbox_oldest_pending_seconds` gauge.
- Consumer metrics in the shared consumer path:
  - `amqp_messages_total{queue,outcome=ack|retry|dlq}`.
  - `amqp_handler_duration_seconds`.
- `docker/monitoring/`:
  - Add `alerts.yml` with `ServiceDown` (`up == 0`), high 5xx rate, p95 latency, outbox backlog/age, DLQ growth and the DB pool waiting. Wire it through `rule_files`. There is no Alertmanager; alerts show in the Prometheus UI, and the doc says so.
  - Fix the dashboard's 5xx panel to filter on `status_class="5xx"`.
  - Add outbox, AMQP and errors panels.
  - Set the Grafana admin password from env.
- Make Prometheus targets configurable so the same config works for host apps and the compose app stack: `entrypoint.sh` writes a `file_sd` JSON from `PROMETHEUS_TARGETS` (default the `host.docker.internal` ports; the compose overlay sets container hostnames). Decided in `tasks.md`.

### Phase 5: Docker, deployment and CD
- Root `.dockerignore` excluding `node_modules`, `dist`, `coverage`, `.turbo`, `.env*` (except the examples), `.git`, `specs`, `.claude` and test reports.
- Rewrite the 3 backend Dockerfiles with a shared pattern. Prove it on core first (image builds, container starts, `/health` returns 200) before rewriting auth and notifications, because `turbo prune` lockfile pruning with npm workspaces on turbo 1.13 has known bugs:
  - **prune stage:** `npx turbo prune <app> --docker`.
  - **deps stage:** `npm ci` on the pruned lockfile.
  - **build stage.**
  - **runner stage:** `npm ci --omit=dev` from the pruned `json/` output, copies the app `dist` plus `packages/{shared,contracts}/dist`, runs as `USER node`, and has a `HEALTHCHECK` (wget `/health`).
- Migrations in containers:
  - Add a compiled entry per app, `src/migrate.ts`, that builds the DataSource from config and runs `runMigrations()`.
  - Fix auth's `config/database.ts` glob to `migrations/*.{ts,js}`. Check the runtime DataSource config that `migrate.ts` uses in core and notifications too, not only the root `data-source.ts` (which already uses `{.ts,.js}`), and confirm the compiled `dist/migrations/*.js` are picked up in all 3.
  - Compose runs `node dist/migrate.js` as a one-shot `*-migrate` service before each app starts.
- client_app Dockerfile: Next `output: 'standalone'`, with `NEXT_PUBLIC_*` passed as build args, running as non-root. These values are fixed when the image is built, so a client image only works for the URLs it was built with. The GHCR client image is built for the compose setup's default URLs. DEPLOYMENT.md says that other environments must rebuild the client with their own build args.
- Compose:
  - `docker-compose.yml`: add healthchecks to postgres, redis, redis-cache, rabbitmq and mailpit, and `restart: unless-stopped`.
  - New `docker-compose.apps.yml` overlay:
    - The 4 apps plus 3 migrate jobs, with `depends_on: condition: service_healthy` and `service_completed_successfully`.
    - Container hostnames come from `.env.production.example`.
    - Port 3012 is not published.
    - Run with `docker compose -f docker-compose.yml -f docker-compose.apps.yml up`.
- New CD workflow `.github/workflows/docker-images.yml`:
  - A matrix over the 4 apps using `docker/build-push-action` with GHA cache.
  - Builds only on PRs; builds and pushes to `ghcr.io/<owner>/innogram-<app>` on `main` (tag `sha`, `latest`) and on `v*` tags (semver).
  - Uses `GITHUB_TOKEN` with `packages: write`.

### Phase 6: API documentation (Swagger)
- Core `main.ts`:
  - Add `addBearerAuth()`, and give the tag list one consistently capitalised tag per controller (`chats` → `Chats`, and the others).
  - Fix the port comment.
  - Gate setup on `SWAGGER_ENABLED`, defaulting to on except in production.
- Add `@ApiTags`/`@ApiOperation`/`@Api*Response`/`@ApiBearerAuth` to `posts.controller.ts` and `comments.controller.ts`, following `chats.controller.ts`, which is the fully documented reference. Add response types to profiles, follows and profile-summary. Add `@ApiBearerAuth` to follows' mutating routes. Add `@ApiExcludeController` to core's health and metrics controllers, matching notifications.
- Notifications: `@ApiProperty` on the 6 DTOs, in the explicit style core uses, plus the same env gate.
- Auth `config/swagger.ts`:
  - Fix `servers` to the auth URL taken from config.
  - Auth compiles with `removeComments: true`, so JSDoc `@openapi` blocks never reach `dist/`. Replace swagger-jsdoc comments with a typed OpenAPI object in `src/config/openapi.ts`, so the same spec is served in dev, dist and Docker.
  - Add component schemas for the auth responses, a `refreshCookie` security scheme and health docs.
  - Add the env gate.
- Fix the `password` description in `packages/shared/src/dtos/auth/create-user.dto.ts`.
- Realtime: add `docs/realtime.md`, built from `specs/003-realtime-chat/contracts/realtime-socket.md` and synced with `packages/contracts/src/realtime/events.ts` (add the missing `deletedAt`).
- Add a spec per service that generates the OpenAPI document and asserts every non-excluded route has an operation summary and at least one response. This keeps coverage from regressing.

### Phase 7: Documentation
- Rewrite the root `README.md`:
  - What the project is, with an architecture diagram (ASCII or mermaid) of the 3 services, the client, RabbitMQ, Redis and S3.
  - Prerequisites (Node 20, Docker), a quick start covering per-app `migration:run` and `db:seed`, and a ports and URLs table (apps, Swagger, Mailpit, RabbitMQ UI, Grafana).
  - The scripts table, and links to the docs below.
  - Remove the stale claims.
- New `docs/`:
  - `DEPLOYMENT.md`: building the images, the compose apps overlay, migrations, secrets, TLS/reverse-proxy notes, scaling limits (single core instance for realtime), GHCR images and releases.
  - `ENVIRONMENT.md`: every variable with service, required/optional and default.
  - `OBSERVABILITY.md`: health, metrics, logs and request IDs, the dashboards, the alerts and a runbook.
  - `API.md`: Swagger URLs per service and the auth flow (bearer plus refresh cookie).
  - `realtime.md`: from Phase 6.
- Per-service READMEs:
  - Replace the core and auth boilerplate: purpose, modules, endpoints, env, run, test, migrations.
  - Fix the notifications README.
  - Expand the client_app README.
  - Add short READMEs for `packages/shared` and `packages/contracts`, including the import-boundary rules.
- Add `CONTRIBUTING.md`, covering branching, commit style, the gates to run and DDD conventions, with a link to the guide.
- `LICENSE`: the README claims MIT; confirm the copyright holder with the user before adding it. Ask at the start of the work, not during this phase, so it doesn't block the docs.
- Update `AGENTS.md`, `CLAUDE.md` and `DDD_ARCHITECTURE_GUIDE.md` (observability section) for the new scripts, CI name, env vars and Docker flow.

### Phase 8: Final review and verification
- Run `/code-review` on the full branch diff against `main`, and fix the confirmed findings.
- Run every gate in a clean state (see Verification), then tick off the 4 acceptance criteria in this file with evidence.

---

## Verification

- **Code gates (gate-runner):**
  - `npm ci`
  - `npx turbo run build`
  - `npx turbo run type-check`
  - `npx turbo run lint:check`
  - `npm run test:cov` for core, auth, notifications and `@repo/shared`, holding the 70/60 thresholds
  - core `test:e2e`
  - notifications e2e
- **Env:** start core and notifications with a required var missing → they exit at bootstrap with a clear message. Start auth with `NODE_ENV=production` and the placeholder JWT secret → it refuses to start.
- **Docker (this checks the deployment guide):**
  - Run the verification as a separate compose project, `-p innogram-verify`. **Never `down -v` the default project**: its volumes hold the dev data. The verify stack uses the same host ports as the dev stack, so stop the dev stack (`docker compose stop`, no `-v`) and any host-run apps first.
  - Follow `docs/DEPLOYMENT.md` exactly: `docker compose -p innogram-verify -f docker-compose.yml -f docker-compose.apps.yml up --build -d`. Tear down with `docker compose -p innogram-verify ... down -v`, which only removes the verify project's volumes.
  - All services reach healthy, and the migrate jobs exit 0.
  - `curl` returns 200 from `/health` on 3001, 3002 and 3003, the client loads on 3000, and the Swagger UIs show populated schemas.
  - The Playwright `npm run e2e` passes against the containerised stack.
  - `docker run --rm <image> id` shows a non-root user.
- **Observability:**
  - The `--profile monitoring` targets are all UP in Prometheus, and the alert rules are loaded (`/api/v1/rules`).
  - Stopping core fires `ServiceDown` (pending/firing).
  - Grafana panels show data.
  - A request with `X-Request-Id: test-123` → the same ID appears in the core access log and in the notifications consumer log for the resulting event.
- **CD:** open a PR → the `docker-images` workflow builds all 4 images without pushing. After merge, the images appear in GHCR.
- **Docs:** check every command in the README and DEPLOYMENT.md against `package.json` scripts and compose. Check every var in `ENVIRONMENT.md` against a `grep process.env|config.get` sweep.
