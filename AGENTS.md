# AGENTS.md

Innogram — a Turborepo + npm-workspaces monorepo (Node 20, TypeScript) for a social media app. Deep architecture detail lives in `DDD_ARCHITECTURE_GUIDE.md`; read it before touching backend code.

## Layout & package boundaries

- `apps/core_microservice` — NestJS API, **Hexagonal/DDD** (`src/modules/{profiles,posts,comments,chats,assets,follows,internal-events,likes,notifications-relay}`). Canonical reference module is `modules/profiles`. Owns the Socket.IO gateway on the `/realtime` namespace (chats, live notifications).
- `apps/auth_microservice` — **bare Express + manual DI**, same Ports & Adapters layering (`src/{config,domain,infrastructure,middleware,routes,services,types}`). No NestJS.
- `apps/notifications_consumer_microservice` — NestJS REST API (`notifications`, `notifications/preferences`, Swagger at `/api`) plus RabbitMQ consumers and SMTP email. Own DB `innogram_notifications`. Layout `src/{config,common/{redis,auth,messaging},modules/{notifications,preferences}}`; modules split into `domain/`, `application/`, `infrastructure/`.
- `apps/client_app` — Next.js App Router web client. Imports `@repo/contracts` only, **never `@repo/shared`**.
- `packages/contracts` (`@repo/contracts`) — **zero-dependency** wire-format types (request/response interfaces). Safe to import from the frontend.
- `packages/shared` (`@repo/shared`) — backend-only infra (TypeORM base classes, DTOs, `DomainError`, `WinstonLogger`, `DomainExceptionFilter`). **Never import this from frontend code.**

Where a new type goes: wire-format request/response → `@repo/contracts`; `class-validator` DTO → `@repo/shared/dtos`; domain entity/port → inside the module's `domain/`.

## Commands

Root scripts delegate to `turbo run` (`dev`, `build`, `test`, `lint`, `type-check`). To target one package: `npm run <script> -w <name>`, e.g. `npm run test -w core_microservice` or `cd apps/core_microservice && npm run test`.

- **Tests**: Jest, unit specs are `*.spec.ts` with `rootDir: src`. `test:e2e` uses a separate config in `test/`. `core_microservice`, `auth_microservice` and `notifications_consumer_microservice` have real specs (notifications also has `test/notifications.e2e-spec.ts`), but CI only runs unit tests for `core_microservice`.
- **Build order matters**: `@repo/shared` and `@repo/contracts` are consumed via their built `dist/` (`main`/`types` point at `dist/index.js`). Turborepo's `^build` dependency handles this for `build`/`test`/`dev`, but running a single app standalone requires `npm run build -w @repo/shared -w @repo/contracts` first. A stale `dist/` shows up as confusing type errors.
- **`npm run type-check` is incomplete**: only `auth_microservice` and `client_app` define a `type-check` script. CI uses `turbo run build` as the de-facto type check.
- **`npm run lint` only lints the apps** — `packages/*` define no `lint` script.

## Migrations (TypeORM, `synchronize: false`)

Migrations are per-app, run from each app's directory against its own database:

```bash
cd apps/core_microservice && npm run migration:run   # also migration:generate / migration:revert
cd apps/auth_microservice && npm run migration:run
```

The CLI uses the `data-source.ts` at the app root (not `src/`), which loads the root `.env` itself. Migrations live in `src/migrations/`. **Root `npm run db:migrate` / `db:seed` are no-ops** — no workspace defines those scripts (the README is stale here).

## Environment & databases

- Single root `.env` (gitignored; copy from `.env.example`). Each service loads it via `dotenv`/`@nestjs/config`.
- Each service owns its own database: `innogram_auth`, `innogram_core`, `innogram_notifications` (`DB_NAME_*`). `docker-compose up` + the Postgres init script create all three.
- **Each service uses its own port var, never a shared `PORT`**: `CORE_PORT` (3001), `AUTH_PORT` (3002), `NOTIFICATIONS_PORT` (3003), `CLIENT_PORT` (3000). Defaults are in code if unset.
- Infrastructure (`npm run docker:up`): Postgres, Redis, SeaweedFS (S3 API on `9000`), RabbitMQ and Mailpit (SMTP on `1025`, web UI on `8025`). Code uses Postgres, Redis (auth refresh sessions and token blacklists; core's `JwtAuthGuard` checks the access blacklist and fails closed with 503 when Redis is down; the `auth:session-revoked` pub/sub channel, published by auth on logout, is consumed by core's `session-revocation.listener.ts`), S3 storage via SeaweedFS (core assets, `modules/assets/infrastructure/storage/s3-storage.adapter.ts`) and RabbitMQ (`RABBITMQ_URL`).
- **RabbitMQ topology**: topic exchange `innogram.events` carries core's outbox events (core writes them transactionally to an outbox table and publishes them). `notifications.events` (`social.#` and chat alerts) and `notifications.email` are consumed by notifications. `notifications.events` has `.retry` and `.dlq` queues; `notifications.email` has only a `.retry` queue (no DLQ). Notifications publishes `notification.created` / `notification.seen` back to the exchange; core's `core.realtime-relay` queue (binding `notification.#`) relays them to the recipient's `user:{id}` room on `/realtime`.
- **Service-specific environment variables**: `RABBITMQ_URL` (core, notifications); `AUTH_INTERNAL_PORT` (3012), `AUTH_INTERNAL_HOST` (default `127.0.0.1`) and `AUTH_INTERNAL_URL` (notifications → auth); `INTERNAL_API_TOKEN` (32+ chars, must match between auth and notifications for the `/internal/users/:id/contact` call); `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, optional `SMTP_USER`/`SMTP_PASS` (notifications; defaults point at local Mailpit `localhost:1025`).
- **Deployment notes**:
  - Auth runs a second, internal-only listener on `AUTH_INTERNAL_HOST`:`AUTH_INTERNAL_PORT` (default `127.0.0.1:3012`) serving `GET /internal/users/:id/contact`, guarded by `X-Internal-Token` / `INTERNAL_API_TOKEN`. In containers set `AUTH_INTERNAL_HOST=0.0.0.0` and never publish port 3012. Notifications reaches it through `AUTH_INTERNAL_URL`.
  - Auth returns only `{ accessToken, user }` in JSON. The refresh token is the httpOnly `refresh_token` cookie (path `/auth`) that `/auth/refresh` and `/auth/logout` read, so the client calls auth with `credentials: 'include'` and `AUTH_ALLOWED_ORIGINS` (comma-separated) must list the client origin. `AUTH_COOKIE_SAMESITE` defaults to `strict`; set `none` (with `NODE_ENV=production` for `Secure`) only when client and auth are on different sites.
  - Single-instance limitation: core's relay consumes one shared durable queue and core has no socket.io Redis adapter. With more than one core instance, a notification only reaches sockets on the instance that consumes it.
- `auth_microservice` `config/env.ts` does fail-fast validation of required vars (throws on missing).

## Architecture conventions (get these right)

- **Domain errors**: entities/repositories throw `DomainError` subclasses (`@repo/shared`); a global `DomainExceptionFilter` (NestJS) or `errorHandler` (Express) maps them to HTTP. Don't throw `HttpException` from domain code. Business rules live in entity methods (`static create()`, `editBio()`, `publish()`), not in services/controllers.
- **Ports & Adapters**: services depend on port interfaces (`domain/interfaces/`), not concrete adapters. In `core_microservice` ports bind via NestJS DI; in `auth_microservice` they're wired manually in `app.ts` `createApp()`.
- **Auth → Core is HTTP fire-and-forget** (`POST /internal/events/user-created`), not a message broker; profile creation has a lazy-init fallback. The endpoint is internal-only (Docker network). Core ↔ notifications traffic goes through RabbitMQ instead (see Environment & databases).
- **IDOR**: mutating endpoints use `JwtAuthGuard` + `@CurrentUser()` (NestJS) / `requireAuth` (Express) and verify `user.sub` ownership in the service.

## Lint / format

- Root `.eslintrc.json` is **legacy/unused**. Each app uses flat `eslint.config.mjs` (typescript-eslint type-checked) and `.prettierrc` (`singleQuote: true`, `trailingComma: "all"`).
- The `lint` script runs `eslint --fix` — it mutates files.

## CI

`.github/workflows/ci-pipepline.yml` (note the misspelled filename): Node 20, `npm ci`, then `npx turbo run lint` → `npx turbo run build`, then unit tests for `core_microservice` only.
