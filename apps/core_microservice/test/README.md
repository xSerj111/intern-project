# core_microservice e2e tests

Run from `apps/core_microservice`: `npx jest --config test/jest-e2e.json <file>` (or `npm run test:e2e`). The suites hit real infrastructure; nothing is mocked.

## What must be running

| Dependency | Needed by | Notes |
| --- | --- | --- |
| Postgres | all suites | `innogram_core` (migrated), plus `innogram_auth` for suites that register users |
| Redis | all suites | `JwtAuthGuard` fails closed with 503 without it; session revocation pub/sub |
| redis-cache | cache suites (from B4) | second Redis on `CACHE_REDIS_PORT` (6380) |
| RabbitMQ | social, notifications-relay, outbox suites | topic exchange `innogram.events` |
| SeaweedFS | attachments, profile-posts (avatar), upload suites | S3 API on `9000` |
| auth_microservice | suites using `registerAndLogin` / `login` | `AUTH_URL`, default `http://localhost:3002` |
| notifications_consumer_microservice | notifications-relay suite | consumes events and publishes `notification.created` back |

`npm run docker:up` starts the infrastructure. Env comes from the root `.env`.

## Helpers (`test/helpers`)

New suites use these; existing suites are not migrated.

- `app.helpers.ts`
  - `createE2eApp(env?)` returns `{ app, http, db, close }`. Sets `env` before `AppModule` is imported (e.g. `{ PERF_INSTRUMENTATION: 'true' }`, short upload TTLs), mirrors `main.ts` global pipe and filter, listens on port 0. `close()` closes the app and restores env.
- `api.helpers.ts`
  - `bearer(session)` returns the `Authorization` header.
  - `internalTokenHeader()` returns `X-Internal-Token` from `INTERNAL_API_TOKEN` (root `.env`).
  - `dbQueryCount(res)` parses `X-Db-Query-Count`; throws when absent (needs `PERF_INSTRUMENTATION=true`).
  - `metricValue(registry, name, labels)` reads one series from a prom-client `Registry` (0 if not yet recorded).
- `data.helpers.ts`
  - `createPublishedPosts(http, session, n, { content? })` creates and publishes `n` posts in order.
  - `setCreatedAt(db, table, id, isoWithMicros)` sets `createdAt` by direct SQL, for tie-breaker tests.
  - `uniqueSuffix()` returns a collision-free string.
- Older helpers: `realtime.helpers.ts` (`registerAndLogin`, `registerMany`, `connectSocket`, `Session`), `cleanup.helpers.ts` (`cleanupE2eData`), `attachment.helpers.ts` (sample file bytes).
