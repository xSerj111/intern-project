# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Read `DDD_ARCHITECTURE_GUIDE.md` before touching `core_microservice`. The rest of this file covers only what `AGENTS.md` doesn't.

## Single package / single test

```bash
cd apps/core_microservice && npx jest comments.service         # one spec by filename pattern
cd apps/core_microservice && npx jest -t "creates a comment"   # one test by name
cd apps/core_microservice && npm run test:e2e                  # uses test/jest-e2e.json
npm run build -w core_microservice                             # nest build
```

## Gotchas

- **`notifications_consumer_microservice` is a stub.** Its controller is empty and nothing publishes to it. Don't assume a working notification pipeline exists.
- **`prisma` and `@prisma/*` are in the root `package.json` but unused.** Persistence is TypeORM everywhere.
- **`auth_microservice` imports `src/...` paths in some files** (e.g. `infrastructure/events/http-event-publisher.ts`), so keep the path resolution in mind when moving files.

## Big picture: how the services fit together

1. **`auth_microservice`** (Express, manual DI in `src/app.ts` `createApp()`) owns credentials, JWTs, Redis-backed sessions and Google OAuth. Its own DB is `innogram_auth`.
2. **`core_microservice`** (NestJS) owns the social graph and content: profiles, posts, comments, chats, follows, assets. Its own DB is `innogram_core`.
3. **Auth → Core is HTTP fire-and-forget.** When a user is created, `UsersService` calls `HttpEventPublisher`, which POSTs `UserCreatedEvent` to `core` at `/internal/events/user-created` without awaiting. `core`'s `InternalEventsController` forwards it to `ProfilesService.createProfile`. Failures are logged, not retried. Profile creation also has a lazy-init fallback in `core`, so a lost event does not leave a user without a profile.

Inside `core_microservice`, the DDD layering is the same in every module (`profiles` is the reference), and the flow of a request is:

`controller` (HTTP, DTO validation via global `ValidationPipe`) → `service` (orchestration, ownership checks via `user.sub`) → `domain entity` (business rules, throws `DomainError`) → `repository port` (bound to a TypeORM adapter through a `Symbol` DI token) → `DomainExceptionFilter` (maps `DomainError` to HTTP).

Entities are both domain objects and TypeORM entities (they extend `TypeormEntityBase`), so a rule like "only drafts can be published" lives on `Post.publish()`, not in the service.

Cross-cutting setup lives in `main.ts` (helmet, cookie-parser, CORS from `CLIENT_URL`, global pipes and filter).
