# AGENTS.md

Innogram — a Turborepo + npm-workspaces monorepo (Node 20, TypeScript) for a social media app. Deep architecture detail lives in `DDD_ARCHITECTURE_GUIDE.md`; read it before touching backend code.

## Layout & package boundaries

- `apps/core_microservice` — NestJS API, **Hexagonal/DDD** (`src/modules/{profiles,posts,comments,chats,assets,follows,internal-events}`). Canonical reference module is `modules/profiles`.
- `apps/auth_microservice` — **bare Express + manual DI**, same Ports & Adapters layering (`src/{config,domain,infrastructure,middleware,routes,services,types}`). No NestJS.
- `apps/notifications_consumer_microservice` — NestJS, flatter structure (`src/{entities,notifications}`), not full DDD.
- `apps/client_app` — Next.js App Router web client. Imports `@repo/contracts` only, **never `@repo/shared`**.
- `packages/contracts` (`@repo/contracts`) — **zero-dependency** wire-format types (request/response interfaces). Safe to import from the frontend.
- `packages/shared` (`@repo/shared`) — backend-only infra (TypeORM base classes, DTOs, `DomainError`, `WinstonLogger`, `DomainExceptionFilter`). **Never import this from frontend code.**

Where a new type goes: wire-format request/response → `@repo/contracts`; `class-validator` DTO → `@repo/shared/dtos`; domain entity/port → inside the module's `domain/`.

## Commands

Root scripts delegate to `turbo run` (`dev`, `build`, `test`, `lint`, `type-check`). To target one package: `npm run <script> -w <name>`, e.g. `npm run test -w core_microservice` or `cd apps/core_microservice && npm run test`.

- **Tests**: Jest, unit specs are `*.spec.ts` with `rootDir: src`. `test:e2e` uses a separate config in `test/`. `core_microservice` and `auth_microservice` have real specs (notifications' specs cover an empty skeleton), but CI only runs unit tests for `core_microservice`.
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
- Infrastructure (`npm run docker:up`): Postgres, Redis, MinIO and RabbitMQ. Code uses Postgres, Redis (auth refresh sessions and token blacklists; core's `JwtAuthGuard` checks the access blacklist and fails closed with 503 when Redis is down) and MinIO/S3 (core assets, `modules/assets/infrastructure/storage/s3-storage.adapter.ts`). **Nothing references RabbitMQ.**
- `auth_microservice` `config/env.ts` does fail-fast validation of required vars (throws on missing).

## Architecture conventions (get these right)

- **Domain errors**: entities/repositories throw `DomainError` subclasses (`@repo/shared`); a global `DomainExceptionFilter` (NestJS) or `errorHandler` (Express) maps them to HTTP. Don't throw `HttpException` from domain code. Business rules live in entity methods (`static create()`, `editBio()`, `publish()`), not in services/controllers.
- **Ports & Adapters**: services depend on port interfaces (`domain/interfaces/`), not concrete adapters. In `core_microservice` ports bind via NestJS DI; in `auth_microservice` they're wired manually in `app.ts` `createApp()`.
- **Auth → Core is HTTP fire-and-forget** (`POST /internal/events/user-created`), not a message broker; profile creation has a lazy-init fallback. The endpoint is internal-only (Docker network).
- **IDOR**: mutating endpoints use `JwtAuthGuard` + `@CurrentUser()` (NestJS) / `requireAuth` (Express) and verify `user.sub` ownership in the service.

## Lint / format

- Root `.eslintrc.json` is **legacy/unused**. Each app uses flat `eslint.config.mjs` (typescript-eslint type-checked) and `.prettierrc` (`singleQuote: true`, `trailingComma: "all"`).
- The `lint` script runs `eslint --fix` — it mutates files.

## CI

`.github/workflows/ci-pipepline.yml` (note the misspelled filename): Node 20, `npm ci`, then `npx turbo run lint` → `npx turbo run build`, then unit tests for `core_microservice` only.
