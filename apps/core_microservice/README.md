# core_microservice

NestJS API that owns the Innogram social graph and content: profiles, posts, comments, likes, follows, chats, uploads and assets. It also serves the `/realtime` Socket.IO namespace (live chat and notifications). Own database: `innogram_core`. Default port `3001` (`CORE_PORT`).

The architecture is Hexagonal/DDD. Read [DDD_ARCHITECTURE_GUIDE.md](../../DDD_ARCHITECTURE_GUIDE.md) before changing code here; `modules/profiles` is the reference module.

## Modules

All modules live in `src/modules/`.

| Module                | Owns                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `profiles`            | Profile CRUD (`/profiles`), search, batch lookup by user ids. Reference module.              |
| `profile-summary`     | Cached lightweight profile summary (`GET /profiles/by-user/:userId`)                         |
| `posts`               | Posts, feed (cursor-based), search, posts by author                                          |
| `comments`            | Comments on posts                                                                            |
| `likes`               | Likes on posts and comments                                                                  |
| `follows`             | Follow graph, followers and following lists                                                  |
| `chats`               | Direct and group chats, members, messages, attachment reads, Socket.IO gateway (`/realtime`) |
| `assets`              | Two-step signed direct-to-storage uploads (`/uploads`)                                       |
| `internal-events`     | Internal `POST /internal/events/user-created` called by auth                                 |
| `notifications-relay` | Consumes `notification.#` from RabbitMQ and pushes it to the recipient's `user:{id}` room    |

Cross-cutting code is in `src/common/` (`auth`, `cache`, `db`, `messaging`, `observability`, `redis`, `perf`, and others).

## Layering

`controller` (HTTP, DTO validation through the global `ValidationPipe`) -> `service` (orchestration, ownership checks via `user.sub`) -> `domain entity` (business rules, throws `DomainError`) -> `repository port` (a `Symbol` DI token bound to a TypeORM adapter) -> `DomainExceptionFilter` (maps `DomainError` to HTTP). Domain code never throws `HttpException`.

## Endpoints overview

Authenticated routes use `JwtAuthGuard` (Bearer access token issued by [auth](../auth_microservice/README.md)).

| Area       | Routes                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profiles   | `GET /profiles/me`, `GET /profiles/search`, `GET /profiles/by-users`, `GET /profiles/by-user/:userId`, `GET/PATCH /profiles/:id`                                                            |
| Posts      | `GET /posts/feed`, `GET /posts/search`, `GET /posts/author/:userId`, `GET/PATCH/DELETE /posts/:id`, plus `POST /posts`                                                                      |
| Comments   | `GET /comments/post/:postId`, `PATCH/DELETE /comments/:id`, plus `POST /comments`                                                                                                           |
| Likes      | `PUT/DELETE /posts/:postId/like`, `PUT/DELETE /comments/:commentId/like`                                                                                                                    |
| Follows    | `POST /follows`, `GET /follows/:userId/followers`, `GET /follows/:userId/following`, `DELETE /follows/:followingId`                                                                         |
| Chats      | `POST /chats/direct`, `POST /chats/groups`, `GET /chats`, `GET/PATCH /chats/:chatId`, `POST /chats/:chatId/read`, member routes under `/chats/:chatId/members`, `POST /chats/:chatId/leave` |
| Messages   | `GET/POST /chats/:chatId/messages`, `GET /chats/:chatId/messages/changes`, `PATCH/DELETE /chats/:chatId/messages/:messageId`, `GET /chats/:chatId/messages/:messageId/attachments/:assetId` |
| Uploads    | `POST /uploads`, `POST /uploads/:uploadId/confirm`                                                                                                                                          |
| Operations | `GET /health` (public), `GET /health/details` and `GET /metrics` (`X-Internal-Token`)                                                                                                       |
| Internal   | `POST /internal/events/user-created` (internal network only)                                                                                                                                |

Swagger UI is served at `/api` (`http://localhost:3001/api`); it is on outside production and controlled by `SWAGGER_ENABLED`. The full request/response reference is in [docs/API.md](../../docs/API.md).

## Environment

Core reads its configuration through `AppConfigService` and fails fast at bootstrap when a required variable is missing. Required: `RABBITMQ_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PRIVATE_BUCKET_NAME`, `JWT_SECRET` (the same secret auth signs access tokens with) and `INTERNAL_API_TOKEN` (32+ characters). An empty value counts as unset. Everything else has a default. Copy `.env.example` to the root `.env`; the full table of variables is in [docs/ENVIRONMENT.md](../../docs/ENVIRONMENT.md).

## Commands

Run from `apps/core_microservice` unless noted. Infrastructure first: `npm run docker:up` from the repo root.

| Task                                                             | Command                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Dev server (watch)                                               | `npm run dev`                                                                                                    |
| Build / run built app                                            | `npm run build`, then `npm run start:prod` (`node dist/main`)                                                    |
| Unit tests                                                       | `npm test` (one spec: `npx jest comments.service`)                                                               |
| Coverage (70 lines / 60 branches gate)                           | `npm run test:cov`                                                                                               |
| E2E (real Postgres, Redis, RabbitMQ, SeaweedFS and auth running) | `npm run test:e2e`                                                                                               |
| Lint / type-check                                                | `npm run lint:check`, `npm run type-check`                                                                       |
| Migrations                                                       | `npm run migration:run` (also `migration:generate`, `migration:revert`); in a built image `npm run migrate:prod` |
| Seed dev data                                                    | `npm run db:seed`                                                                                                |
| Seed perf dataset                                                | `npm run db:seed -- --profile perf --reset` (also seed auth the same way)                                        |

Performance (from the repo root, local only, Docker needed; core and auth must already run as `node dist/main`): `npm run perf` (k6 gate plus group fan-out), `npm run perf:baseline`, `npm run perf:compare`. Details and thresholds: [test/load/README.md](test/load/README.md). E2E setup: [test/README.md](test/README.md).

Migrations use the root `data-source.ts` and `synchronize` is off.

## Realtime and outbox

- **Realtime**: the Socket.IO gateway (`modules/chats/infrastructure/realtime/chats.gateway.ts`) serves the `/realtime` namespace. The handshake verifies the access token; core fails closed (`unavailable`) when Redis is down. Events and rooms are described in [docs/realtime.md](../../docs/realtime.md). Core has no Socket.IO Redis adapter, so run a single instance.
- **Outbox**: domain events are written to an outbox table in the same transaction as the change, then a relay (`common/messaging/outbox-relay.ts`) polls and publishes them to the `innogram.events` topic exchange in RabbitMQ. After `OUTBOX_MAX_ATTEMPTS` failures a row is dead-lettered. The notifications service consumes these events and publishes `notification.created` / `notification.seen` back; `notifications-relay` forwards them to clients.
- **Session revocation**: core subscribes to the `auth:session-revoked` Redis channel (`common/redis/session-revocation.listener.ts`) and `JwtAuthGuard` checks the access-token blacklist.
- **Cache**: a second Redis (`CACHE_REDIS_HOST`/`CACHE_REDIS_PORT`, default `localhost:6380`) caches profiles, follow counts and signed URLs with finite TTLs; cache errors are misses, never request errors.

Observability (logs, `/metrics`, alerts): [docs/OBSERVABILITY.md](../../docs/OBSERVABILITY.md). Deployment: [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).
