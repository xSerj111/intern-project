# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `AGENTS.md` first for package boundaries and conventions, and `DDD_ARCHITECTURE_GUIDE.md` before touching `core_microservice`. This file covers what those don't: the cross-service flow and the commands that actually work.

## Commands

Run from the repo root unless noted. Node 20.

```bash
npm ci
npm run build -w @repo/shared -w @repo/contracts   # required before running any app standalone
npm run dev                                         # turbo: all apps in watch mode
npm run lint                                        # eslint --fix in every app (mutates files)
npm run test                                        # turbo run test across workspaces
```

Single package / single test:

```bash
npm run test -w core_microservice                              # unit tests (Jest, rootDir src)
cd apps/core_microservice && npx jest comments.service         # one spec by filename pattern
cd apps/core_microservice && npx jest -t "creates a comment"   # one test by name
cd apps/core_microservice && npm run test:e2e                  # uses test/jest-e2e.json
npm run build -w core_microservice                             # nest build
```

Migrations are per-app and run from that app's directory (`data-source.ts` at the app root, loads the root `.env`):

```bash
cd apps/core_microservice && npm run migration:run
cd apps/auth_microservice && npm run migration:run
```

Infrastructure: `npm run docker:up` starts Postgres (creates `innogram_auth`, `innogram_core`, `innogram_notifications`), Redis, MinIO and RabbitMQ. Code actually uses Postgres, Redis (auth sessions) and MinIO/S3 (core assets, `modules/assets/infrastructure/storage/s3-storage.adapter.ts`). Nothing in the code references RabbitMQ.

## Gotchas

- **Root `db:migrate` / `db:seed` do nothing.** They are wired in `turbo.json` and `package.json` but no workspace defines those scripts. Use the per-app `migration:*` scripts.
- **`type-check` only exists in `auth_microservice`.** Type checking for the rest happens through `turbo run build` (that is what CI runs).
- **Tests run only for `core_microservice` in CI.** `auth_microservice` has no `*.spec.ts` files, and the notifications service has specs for an empty skeleton.
- **`notifications_consumer_microservice` is a stub.** Its controller is empty and nothing publishes to it. Don't assume a working notification pipeline exists.
- **`apps/client_app` has no `package.json`.** Only `tsconfig.json`; there is no frontend to run.
- **`prisma` and `@prisma/*` are in the root `package.json` but unused.** Persistence is TypeORM everywhere.
- **`auth_microservice` imports `src/...` paths in some files** (e.g. `infrastructure/events/http-event-publisher.ts`), so keep the path resolution in mind when moving files.
- **`lint` mutates files** (`--fix`), so running it locally will reformat your changes.

## Big picture: how the services fit together

Four pieces, and the one that matters most is the auth → core event flow:

1. **`auth_microservice`** (Express, manual DI in `src/app.ts` `createApp()`) owns credentials, JWTs, Redis-backed sessions and Google OAuth. Its own DB is `innogram_auth`.
2. **`core_microservice`** (NestJS) owns the social graph and content: profiles, posts, comments, chats, follows, assets. Its own DB is `innogram_core`.
3. **Auth → Core is HTTP fire-and-forget.** When a user is created, `UsersService` calls `HttpEventPublisher`, which POSTs `UserCreatedEvent` to `core` at `/internal/events/user-created` without awaiting. `core`'s `InternalEventsController` forwards it to `ProfilesService.createProfile`. Failures are logged, not retried. Profile creation also has a lazy-init fallback in `core`, so a lost event does not leave a user without a profile. This route is internal-only (Docker network).
4. **Shared packages** split by consumer. `@repo/contracts` holds zero-dependency wire types that any client can import. `@repo/shared` holds backend infrastructure (TypeORM base entity, `DomainError`s, `DomainExceptionFilter`, Winston logger, DTOs) and must never reach the frontend. Both are consumed through their built `dist/`, so a stale build will show up as confusing type errors.

Inside `core_microservice`, the DDD layering is the same in every module (`profiles` is the reference), and the flow of a request is:

`controller` (HTTP, DTO validation via global `ValidationPipe`) → `service` (orchestration, ownership checks via `user.sub`) → `domain entity` (business rules, throws `DomainError`) → `repository port` (bound to a TypeORM adapter through a `Symbol` DI token) → `DomainExceptionFilter` (maps `DomainError` to HTTP).

Entities are both domain objects and TypeORM entities (they extend `TypeormEntityBase`), so a rule like "only drafts can be published" lives on `Post.publish()`, not in the service.

Cross-cutting setup lives in `main.ts` (helmet, cookie-parser, CORS from `CLIENT_URL`, global pipes and filter). Each service reads its own port variable (`CORE_PORT`, `AUTH_PORT`, `NOTIFICATIONS_PORT`), never a shared `PORT`.
