# DDD & Hexagonal Architecture Guide — Innogram Monorepo

**Audience:** Backend and full-stack developers working in the Innogram codebase.  
**Last updated:** 2026-10-26  
**Monorepo root:** `intern-project/`

This guide describes the code as it is. Every code block is a short excerpt; the file path above it is the source of truth. When this guide and the code disagree, the code wins: fix the guide.

---

## 1. System Overview & Turborepo Flow

### 1.1 Monorepo Topology

```
intern-project/
├── apps/
│   ├── auth_microservice/                    # Credentials, JWTs, Redis sessions, Google OAuth (Express + manual DI)
│   ├── core_microservice/                    # Profiles, posts, comments, likes, follows, assets, chats, /realtime gateway (NestJS)
│   ├── notifications_consumer_microservice/  # Notifications, email preferences, RabbitMQ consumers, SMTP (NestJS)
│   └── client_app/                           # Next.js App Router web client (imports @repo/contracts only)
├── packages/
│   ├── contracts/                            # @repo/contracts: zero-dependency wire types
│   └── shared/                               # @repo/shared: backend-only infrastructure (depends on contracts)
├── docker/
│   ├── postgres/init-databases.sh            # creates innogram_auth / innogram_core / innogram_notifications
│   ├── seaweedfs/                            # S3 entrypoint (CORS from CLIENT_URL)
│   └── monitoring/                           # Prometheus config, alerts.yml, token entrypoint, Grafana provisioning (§8.5)
├── seed/                                     # fixtures.ts (dev users), perf.ts (deterministic perf profile helpers)
├── docker-compose.yml                        # infrastructure (below)
├── docker-compose.apps.yml                   # overlay: *-migrate jobs + auth, core, notifications, client images (each app has a Dockerfile)
├── .github/workflows/                        # ci.yml (lint:check → build → type-check, unit-test matrix, §9); docker-images.yml (build, GHCR push on main/tags)
├── docs/                                     # DEPLOYMENT, ENVIRONMENT, OBSERVABILITY, API, realtime
├── turbo.json
└── package.json                              # npm workspaces: apps/*, packages/*
```

`docker-compose.yml` runs Postgres, Redis (auth sessions and blacklists), `redis-cache` (core's response cache, host port 6380, no persistence, `allkeys-lru`, §3.14), SeaweedFS (S3 API on 9000), RabbitMQ and Mailpit. The opt-in `monitoring` profile adds Prometheus and Grafana (host port 3030). `npm run docker:apps:up` adds the containerised apps from `docker-compose.apps.yml` using `.env.production` (`docs/DEPLOYMENT.md`).

### 1.2 Architectural Styles

| Service                               | Framework | DI                                               | Database                 | Layout                                                                                                    |
| ------------------------------------- | --------- | ------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `auth_microservice`                   | Express   | Manual, in `createApp()` / `createInternalApp()` | `innogram_auth`          | `src/{config,domain,infrastructure,middleware,migrations,routes,services,types}`, `seed/` at the app root |
| `core_microservice`                   | NestJS    | Nest IoC, ports bound to `Symbol` tokens         | `innogram_core`          | `src/modules/<module>/{domain,dto,infrastructure}` (§3), `src/common/`, `test/` (e2e, load), `seed/`      |
| `notifications_consumer_microservice` | NestJS    | Nest IoC, ports bound to `Symbol` tokens         | `innogram_notifications` | `src/modules/<module>/{domain,application,dto,infrastructure}` (§5), `src/common/`                        |
| `client_app`                          | Next.js   | —                                                | —                        | `src/app/{(app),(auth)}` route groups, `src/{components,lib,types}`, Playwright in `e2e/`                 |

All three backends follow Ports & Adapters: domain entities and port interfaces in `domain/`, adapters in `infrastructure/`, application services that depend on ports only. Each service owns its database and its port variable (`AUTH_PORT` 3002, `CORE_PORT` 3001, `NOTIFICATIONS_PORT` 3003, `CLIENT_PORT` 3000); no service reads another service's database.

### 1.3 How Services Talk to Each Other

```
 client_app ── HTTP ──────────────────▶ auth           (:3002)
 client_app ── HTTP + Socket.IO /realtime ─▶ core   (:3001, ChatsGateway)
 client_app ── HTTP ──────────────────▶ notifications (:3003)
 client_app ── presigned multipart POST ─▶ SeaweedFS (:9000)   (between POST /uploads and /confirm, §3.13)

 auth ── POST /internal/events/user-created (fire-and-forget) ──▶ core
 auth ── Redis pub/sub "auth:session-revoked" ──────────────────▶ core (closes sockets)
 core ── outbox → RabbitMQ exchange innogram.events ─────────────▶ notifications (social.#, chat.message.alerted)
 notifications ── innogram.events notification.* ───────────────▶ core relay ─▶ user:{id} room
 notifications ── GET /internal/users/:id/contact (X-Internal-Token) ─▶ auth internal listener (:3012)
 core ── cache-aside reads/deletes ──▶ redis-cache (:6380)                            (§3.14)
 Prometheus ── GET /metrics (X-Internal-Token) ──▶ core :3001, auth :3002, notifications :3003   (§8)
```

| Channel                                                         | Producer → consumer                   | Delivery                                             | Details |
| --------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- | ------- |
| `POST /internal/events/user-created`                            | auth → core                           | HTTP, fire-and-forget, no retry                      | §7      |
| `auth:session-revoked`                                          | auth → core                           | Redis pub/sub, not durable                           | §3.10   |
| `innogram.events` (`social.*`, `chat.message.alerted`)          | core → notifications                  | transactional outbox, at-least-once                  | §3.11   |
| `innogram.events` (`notification.created`, `notification.seen`) | notifications → core                  | AMQP, relayed to sockets                             | §3.11   |
| `GET /internal/users/:id/contact`                               | notifications → auth                  | HTTP on an internal-only listener                    | §4.7    |
| `GET /health/details`, `GET /metrics`                           | Prometheus, operators → every backend | HTTP on each service's main port, `X-Internal-Token` | §8      |

`INTERNAL_API_TOKEN` is one value shared by all three backends; each refuses to start without it (32+ characters).

### 1.4 How Turborepo Orchestrates Builds

`turbo.json` (Turborepo 1.x, so the top-level key is `pipeline`, not `tasks`):

```jsonc
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "build/**"] },
    "dev": { "dependsOn": ["^build"], "cache": false, "persistent": true },
    "test": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "lint:check": { "dependsOn": ["^build"] },
    "type-check": { "dependsOn": ["^build"] },
    "client_app#type-check": { "dependsOn": ["^build", "build"] },
    "clean": { "cache": false },
    "db:migrate": { "cache": false },
    "db:seed": { "cache": false },
  },
}
```

`^build` builds a workspace's dependencies first. The graph is `@repo/contracts` → `@repo/shared` (shared imports contracts, §2.2) → apps. The apps consume both packages through `dist/` (`main`/`types` point at `dist/index.js`), so running one app standalone needs `npm run build -w @repo/contracts -w @repo/shared` first, contracts before shared; a stale `dist/` shows up as confusing type errors.

`db:seed` runs the auth and core seeds (`seed/` in each app, §9); `db:migrate` runs `migration:run` in each of the three backends (each against its own database; the Docker `*-migrate` jobs run the compiled `node dist/migrate.js`, i.e. `migrate:prod`). `lint:check` and `type-check` are the read-only CI checks; `lint` runs `--fix`.

---

## 2. The Package Ecosystem: `@repo/contracts` vs. `@repo/shared`

### 2.1 `@repo/contracts`: the wire format

| Property     | Value                                                                         |
| ------------ | ----------------------------------------------------------------------------- |
| Dependencies | none                                                                          |
| Consumed by  | `client_app` and every backend                                                |
| Purpose      | Request/response interfaces, realtime event maps, shared limits and constants |

One folder per area under `packages/contracts/src/` (`assets`, `auth`, `chats`, `comments`, `common`, `follows`, `likes`, `notifications`, `observability`, `posts`, `profiles`, `realtime`, `uploads`), each with an `index.ts` re-exported from `packages/contracts/src/index.ts`. Most areas have `requests.ts` / `responses.ts`; the exceptions are `common/pagination.ts`, `constants.ts` in `chats` and `uploads`, `observability/health.ts` and `realtime/events.ts` (`assets` and `likes` have only `responses.ts`). Interfaces are plain TypeScript: no decorators, no runtime libraries, dates as ISO strings. The runtime constants are limits both sides must agree on: `PAGE_SIZE_MAX`, `CHANGES_PAGE_SIZE_MAX` (§3.12), `MESSAGE_MAX_ATTACHMENTS`, `ATTACHMENT_MAX_BYTES`, `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWLIST` (§3.13).

```typescript
// packages/contracts/src/profiles/responses.ts
export interface IProfileResponse {
  id: string;
  authUserId: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}
```

The Socket.IO protocol is typed here too: `REALTIME_NAMESPACE`, `ServerToClientEvents`, `ClientToServerEvents` and `IRealtimeAckError` in `packages/contracts/src/realtime/events.ts`. The gateway and the client share these maps, so an event name or payload change is a compile error on both sides. The full export list is in A.7.

### 2.2 `@repo/shared`: backend infrastructure

| Property     | Value                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies | `@repo/contracts`, `@nestjs/common`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `typeorm`, `winston`, `jsonwebtoken`, `prom-client` |
| Consumed by  | backends only, **never** `client_app`                                                                                                               |

```
packages/shared/src/
├── index.ts                        # barrel export
├── auth/access-token.verifier.ts   # AccessTokenVerifier (JWT verify + blacklist check), VerifyResult
├── database/                       # TypeormEntityBase (timestamptz audit columns), RepositoryPort, TypeormRepositoryBase, PostgresErrorCode, isTypeOrmError
├── dtos/{auth,core}/               # class-validator DTOs (A.5)
├── errors/                         # DomainError, database errors, AccessDeniedError (A.6)
├── events/                         # UserCreatedEvent, SessionRevokedEvent, EventEnvelope, RoutingKeys, broker payloads, EmailJob
├── filters/domain-exception.filter.ts  # DomainExceptionFilter (Nest)
├── logger/                         # Logger port, LoggerKey, LoggerModule, WinstonLogger
├── observability/                  # createMetricsRegistry, HealthCheck + runHealthChecks, httpMetricsMiddleware,
│                                   # registerDbPoolGauge, internal-token helpers (§8)
└── redis/redis-keys.ts             # RedisKeys, secondsUntil (key layout shared by auth and core)
```

`packages/shared` source uses double quotes; match the file you edit. The dependency runs one way: **shared may import contracts** (`posts-by-author-query.dto.ts` takes `PAGE_SIZE_MAX` from it, `health-runner.ts` its health types), and contracts imports nothing. Some types still exist in both packages from before that edge existed (`NotificationKind` in `events/notification.events.ts`, `POST_LIST_STATUSES` next to `PostStatus`), and their comments still say shared can't import contracts. Alias one of them when a file imports both.

### 2.3 The Decisive Rule: Where Do New Types Go?

| If the type...                                                                           | It goes in...                                           | Because...                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| describes an HTTP request/response or a realtime event payload                           | `@repo/contracts`                                       | the frontend needs it without backend dependencies |
| is a `class-validator` DTO used by both Express and Nest (auth DTOs, `UpdateProfileDto`) | `packages/shared/src/dtos/`                             | it depends on `class-validator`                    |
| is a request/response DTO used by one core module                                        | the module's `dto/` folder                              | module-specific                                    |
| is an entity, props interface, port or domain error                                      | the module's `domain/` folder                           | module-specific                                    |
| is a cross-service event class (validated)                                               | `packages/shared/src/events/`                           | both producer and consumer validate it             |
| is a Redis key or channel shared by auth and core                                        | `packages/shared/src/redis/redis-keys.ts`               | both services must agree on the string             |
| is a page-size limit or a list envelope (`PAGE_SIZE_MAX`, `IOffsetPage`)                 | `packages/contracts/src/common/pagination.ts`           | DTO limits and the client must match (§3.12)       |
| is a core cache key, TTL or cache metric label                                           | `apps/core_microservice/src/common/cache/cache-keys.ts` | core-only, separate Redis instance (§3.14)         |
| is a health or metrics helper used by more than one service                              | `packages/shared/src/observability/`                    | one implementation for all three (§8)              |
| is a health wire type (`IHealthReport`)                                                  | `packages/contracts/src/observability/health.ts`        | returned by every `/health` route                  |

Request DTOs `implements` the matching contracts interface, so the wire type and the validated class can't drift: `export class SendMessageDto implements ISendMessageRequest`.

---

## 3. Module Anatomy & Hexagonal Architecture — `core_microservice` (NestJS)

### 3.1 The Reference Module: `modules/profiles`

```
modules/profiles/
├── profiles.module.ts
├── profiles.controller.ts
├── profiles.service.ts
├── domain/
│   ├── entities/
│   │   ├── user-profile.entity.ts             # aggregate (extends TypeormEntityBase)
│   │   ├── user-profile.entity.spec.ts        # domain rule tests, no Nest
│   │   └── profile-to-profile-configuration.entity.ts
│   ├── interfaces/
│   │   ├── user-profile.props.ts              # persisted columns, no TypeORM
│   │   ├── user-profile-repository.port.ts    # IUserProfileRepository + UserProfileRepositoryKey
│   │   ├── user-directory.port.ts             # IUserDirectoryPort + USER_DIRECTORY_PORT (cross-module, §3.4)
│   │   └── avatar-asset.port.ts               # IAvatarAssetPort + AVATAR_ASSET_PORT (over AssetsService)
│   └── errors/user-profile.errors.ts
├── dto/{create-profile.dto.ts, profile-response.dto.ts, search-profiles-query.dto.ts}
├── infrastructure/
│   ├── repository/user-profile.repository.ts  # TypeORM adapter
│   ├── user-directory.adapter.ts              # IUserDirectoryPort adapter
│   └── avatar-asset.adapter.ts                # IAvatarAssetPort adapter (READY asset, avatar purpose)
└── __tests__/fakers/{index.ts, user-profile.faker.ts}
```

Specs sit next to the file they cover (`*.spec.ts` in every folder above). Profiles is the reference for the layout, not for every injection: `ProfilesService` still injects the concrete `UserProfileRepository` and `ProfileSummaryCache` (§3.3).

Larger modules add `infrastructure/realtime/` (chats gateway), `infrastructure/storage/` (assets, chat attachments), `infrastructure/content/` (assets' content sniffer) and background jobs (`infrastructure/pending-upload.sweeper.ts`, §3.13). They split services by use case (`chats.service.ts`, `messages.service.ts`, `chat-membership.service.ts`; `assets.service.ts` as the facade other modules use, `uploads.service.ts` for the HTTP flow). Domain value objects that aren't entities sit in `domain/` directly (`posts/domain/feed-cursor.ts`, §3.12).

A request flows: **controller** (HTTP mapping, DTO validation) → **service** (orchestration, loading, transactions) → **entity method** (business rule, throws `DomainError`) → **repository port** (bound to a TypeORM adapter by a `Symbol` token) → **post-commit side effects** (realtime emits, cache invalidation) → **`DomainExceptionFilter`** (maps `DomainError` to HTTP).

### 3.2 The Layers

#### Layer 1: Domain Entities (`domain/entities/`)

Entities are both domain objects and TypeORM entities: they extend `TypeormEntityBase` (`id` uuid, `createdAt`, `updatedAt`, `deletedAt`). Construction goes through a `static create()` factory; every rule is an entity method that throws a `DomainError` subclass.

```typescript
// apps/core_microservice/src/modules/profiles/domain/entities/user-profile.entity.ts
@Entity("user_profiles")
export class UserProfile extends TypeormEntityBase implements UserProfileProps {
  @Index()
  @Column({ type: "uuid", unique: true })
  authUserId!: string;
  // ... username, displayName, bio, avatarUrl ...

  static create(props: CreateUserProfileProps): UserProfile {
    const profile = new UserProfile();
    profile.authUserId = props.authUserId;
    profile.username = props.username;
    profile.displayName = props.displayName?.trim() || props.username;
    return profile;
  }

  editBio(bio: string | null): void {
    if (bio !== null && bio.length > PROFILE_BIO_MAX_LENGTH) {
      throw new InvalidProfileBioError(bio.length);
    }
    this.bio = bio ?? undefined;
  }
}
```

Rules that involve the caller live on the entity too, with the caller's id as an argument:

```typescript
// apps/core_microservice/src/modules/chats/domain/entities/message.entity.ts
edit(actorId: string, content: string, changeSeq: number): void {
  this.assertMutableBy(actorId); // SYSTEM → NotMessageAuthorError → MessageAlreadyDeletedError
  // ... length/empty checks, then mutate ...
}
private assertMutableBy(actorId: string): void {
  if (this.kind === 'SYSTEM') throw new SystemMessageImmutableError();
  if (this.authorId !== actorId) throw new NotMessageAuthorError(); // extends AccessDeniedError → 403
  if (this.deletedAt != null) throw new MessageAlreadyDeletedError();
}
```

Other examples: `Post.publish()` / `archive()` / `assertLikeableBy()`, `Comment.edit()` / `notifiesPostAuthor()`, `Chat.assertCanRead()` / `addMembers()` / `leave()`, `Follow.notifiesFollowed()`, and the upload lifecycle on `Asset` (`createPending()`, `assertConfirmableBy()`, `assertStoredSizeAcceptable()`, `confirm()`, `reject()`, `assertAttachableTo()`, `isSweepable()`, §3.13). A factory may assign the `id` itself when something outside the row needs it before the insert: `Asset.createPending` sets `id = randomUUID()` so the storage key `pending/{uploaderId}/{id}` exists before the save.

Conventions:

- Never call `new Entity()` outside its factory or a test faker. Two places still do: `ProfileSummaryService` rebuilds a `UserProfile` from a cache entry with `Object.assign(new UserProfile(), …)`, and `PostsService` builds `PostAsset` rows with `new PostAsset()`.
- Cross-module references use `import type` and a string relation target, so modules don't import each other's entities at runtime: `@ManyToOne('UserProfile')`.
- Every date column is `timestamptz`. `TypeormEntityBase` declares its audit columns that way; an entity that doesn't extend it (`PostLike`, `CommentLike`, `ChatParticipant`, `MessageAttachment`, ...) declares `{ type: 'timestamptz' }` itself. Plain `timestamp` columns were read back in the process's local zone and shifted instants (fixed by the `TimestampsWithTimeZone` migration in each service).
- Columns that point at a user store the **auth user id** (the JWT `sub`) and reference `user_profiles."authUserId"`, not `user_profiles.id`. Give FKs, indexes and unique constraints explicit names so `migration:generate` doesn't invent its own (indexes TypeORM can't express live only in migrations, §3.15):

```typescript
// apps/core_microservice/src/modules/comments/domain/entities/comment.entity.ts
@ManyToOne('UserProfile')
@JoinColumn({
  name: 'authorId',
  referencedColumnName: 'authUserId',
  foreignKeyConstraintName: 'FK_comments_authorId_authUserId',
})
author!: UserProfile;
```

- `bigint` columns that must surface as `number` use `bigintNumberTransformer` from `apps/core_microservice/src/common/typeorm/bigint-number.transformer.ts`.
- Group-chat methods (`Chat.createGroup`, `addMembers`, `removeMember`, `leave`) mutate in memory and **return** `SystemEvent[]`; the service persists them with narrow repository writes (§3.5).

#### Layer 2: Domain Interfaces (`domain/interfaces/`)

**Props interfaces** describe persisted columns without TypeORM; the entity `implements` them and the repository port is typed against them, so query criteria are checked against real fields.

**Ports** are what services depend on. A repository port usually extends the generic `RepositoryPort<Entity, Props>` from `@repo/shared` and adds domain finders; it is exported together with its DI token:

```typescript
// apps/core_microservice/src/modules/posts/domain/interfaces/post-repository.port.ts
export interface IPostRepository extends RepositoryPort<Post, PostProps> {
  findById(id: string): Promise<Post | null>;
  /** One keyset page of the viewer's feed, `createdAt DESC, id DESC`, strictly after `cursor`. */
  findFeedPage(
    viewerId: string,
    cursor: FeedCursor | null,
    limit: number,
  ): Promise<{ posts: Post[]; nextCursor: string | null }>;
  getCommentCounts(postIds: string[]): Promise<Map<string, number>>;
  getLikeStats(
    postIds: string[],
    viewerId?: string,
  ): Promise<Map<string, LikeStats>>;
  // ... searchPublishedPosts, findByAuthor, countPublishedByAuthor
}

export const POST_REPOSITORY = Symbol.for("IPostRepository");
```

Batch finders (`getCommentCounts`, `getLikeStats`) take every id of a page and return a `Map` with an entry per id, so a list endpoint runs a constant number of queries (§3.15).

`RepositoryPort` (`packages/shared/src/database/repository.port.ts`) covers `findOne`, `findOneOrThrow`, `findOneByIdOrThrow`, `findMany`, `findManyPaginated`, `save`, `saveMultiple`, `delete`, `deleteMultiple`, `deleteByCriteria`, `softDelete`, `count`, `exists`, `upsert`. Ports with very specific persistence (chats, likes, outbox, `IUploadRepository`) don't extend it and declare exactly the operations they need.

Non-repository ports follow the same shape:

| Port / token                                         | Module         | Adapter                    | Notes                                                                                                                     |
| ---------------------------------------------------- | -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `IFileStoragePort` / `FileStoragePortKey`            | assets         | `S3StorageAdapter`         | `presignGet`, `presignPost`, `head`, `readHead(…, ifMatch)`, `copyToPublic`, `copyToPrivate`, `deleteObject(bucket, key)` |
| `IContentSniffer` / `CONTENT_SNIFFER`                | assets         | `FileTypeContentSniffer`   | checks the first bytes against the purpose's allowlist (§3.13)                                                            |
| `IAttachmentStoragePort` / `ATTACHMENT_STORAGE_PORT` | chats          | `AttachmentStorageAdapter` | `findAssets`, `softDeleteAssets`, `presign` (cached), `invalidateSignedUrls`, `deleteObjects`                             |
| `IAvatarAssetPort` / `AVATAR_ASSET_PORT`             | profiles       | `AvatarAssetAdapter`       | `findAvatarSource(assetId)`                                                                                               |
| `IChatRealtimePort` / `CHAT_REALTIME_PORT`           | chats          | `ChatsGateway`             | §3.8                                                                                                                      |
| `IUserDirectoryPort` / `USER_DIRECTORY_PORT`         | profiles       | `UserDirectoryAdapter`     | §3.4                                                                                                                      |
| `ICacheStore` / `CACHE_STORE`                        | `common/cache` | `RedisCacheAdapter`        | §3.14                                                                                                                     |

#### Layer 3: Domain Errors (`domain/errors/`) and the HTTP Mapping

Module errors go in `domain/errors/<module>.errors.ts`, e.g. `assets/domain/errors/asset.errors.ts` (`UploadTooLargeError`, `UploadTypeNotAllowedError`, `UploadExpiredError`, `UploadContentRejectedError`, `AssetNotAttachableError`, ...). A few older ones sit next to their entity (`EmptyCommentError`, `InvalidPostStateError`, `PostStatusNotVisibleError`). All extend `DomainError` (`packages/shared/src/errors/domain.error.ts`), an abstract class with a `protected` constructor that sets `name` to the subclass name. Pick the base class by the status you want; subclasses inherit the mapping:

```typescript
// apps/core_microservice/src/modules/chats/domain/errors/chat.errors.ts
export class ChatNotFoundError extends EntityNotFoundError { ... }   // 404
export class NotChatAdminError extends AccessDeniedError { ... }     // 403
export class MessageTooLongError extends DomainError { ... }         // 400
```

**Error mapping (the one table).** Nest services register `DomainExceptionFilter` from `packages/shared/src/filters/domain-exception.filter.ts` globally (core and notifications); auth uses `apps/auth_microservice/src/middleware/error-handler.middleware.ts`. Both check `instanceof` in this order:

| Error (and its subclasses)                                                                                               | Nest `DomainExceptionFilter`                                                                    | Express `createErrorHandler`                                |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `EntityNotFoundError`, `EntityByIdNotFoundError` (e.g. `ChatNotFoundError`, `MessageNotFoundError`, `UserNotFoundError`) | 404                                                                                             | 404                                                         |
| `AccessDeniedError` (e.g. `NotChatAdminError`, `NotMessageAuthorError`)                                                  | 403                                                                                             | 403                                                         |
| `UniqueConstraintViolationError`                                                                                         | 409                                                                                             | 409                                                         |
| `DatabaseQueryError`                                                                                                     | 500 (logged at error level)                                                                     | 500                                                         |
| `UnauthorizedError`                                                                                                      | **400** (no special case)                                                                       | 401                                                         |
| any other `DomainError` (e.g. `InvalidDisplayNameError`, `MessageTooLongError`)                                          | 400                                                                                             | 400                                                         |
| not a `DomainError`                                                                                                      | not caught: Nest's default handling (an `HttpException` keeps its status, anything else is 500) | 500 `{ statusCode: 500, message: 'Internal Server Error' }` |

Body for mapped errors: `{ statusCode, error: <error class name>, message }`. On the socket, `WsDomainExceptionFilter` (`apps/core_microservice/src/modules/chats/infrastructure/realtime/ws-domain-exception.filter.ts`) acks `{ ok: false, error: { code: <class name>, message } }`, and `InternalError` for anything else.

Domain code never throws `HttpException`. Nest exceptions appear at the HTTP edge (`JwtAuthGuard` 401/503, `InternalTokenGuard` 401) and in two older places: the ownership checks in `PostsService` and `CommentsService` (`ForbiddenException`, §3.6), and `S3StorageAdapter`, which wraps storage failures in `InternalServerErrorException`. For a new 403 rule, extend `AccessDeniedError` instead.

#### Layer 4: DTOs (`dto/`)

Request DTOs implement the contracts interface and carry `class-validator` and `@ApiProperty` decorators. The global `ValidationPipe` is `{ whitelist: true, transform: true }`: **an undecorated property is silently stripped.**

```typescript
// apps/core_microservice/src/modules/chats/dto/edit-message.dto.ts
export class EditMessageDto implements IEditMessageRequest {
  @ApiProperty({
    description: "New message text (0-2000 chars); blank only if attachments",
  })
  @IsString({ message: "Content must be a text" })
  @MaxLength(2000, { message: "Message is too long (max 2000 chars)" })
  content!: string;
}
```

Every list endpoint has a query DTO whose `limit` is bounded by `@Max(PAGE_SIZE_MAX)`: an out-of-range value is a 400, never clamped (§3.12).

Response DTOs take the entity in the constructor and normalise it for the wire: dates → `toISOString()`, optional fields → `?? null`, internal columns such as `deletedAt` left out. Controllers never return entities. Two services build the wire object themselves because it isn't one entity: `FollowsService` returns `IOffsetPage<IFollowListItem>` (profile plus `isFollowedByMe`), and `UploadsService.toResponse` returns `IAssetResponse` or `IUploadedAttachment` depending on the upload purpose.

```typescript
// apps/core_microservice/src/modules/profiles/dto/profile-response.dto.ts
constructor(profile: UserProfile) {
  this.id = profile.id;
  this.bio = profile.bio ?? null;
  this.createdAt = profile.createdAt.toISOString();
  // ...
}
```

Chats builds responses through functions in `apps/core_microservice/src/modules/chats/dto/chat-response.mapper.ts` (`toMessageResponse`, `toConversationSummary`, `toConversationDetail`, `presignAttachments`) because they need user maps and presigned URLs. `presignAttachments` passes the asset id along, which keys the signed-URL cache (§3.14), and uses `Promise.allSettled`: an attachment whose presign fails is returned without a URL instead of failing the response.

#### Layer 5: Infrastructure — Repository Adapter (`infrastructure/repository/`)

```typescript
// apps/core_microservice/src/modules/profiles/infrastructure/repository/user-profile.repository.ts
@Injectable()
export class UserProfileRepository
  extends TypeormRepositoryBase<UserProfile, UserProfileProps>
  implements IUserProfileRepository
{
  public static readonly entity = UserProfile;
  protected relations: string[] = [];

  constructor(
    @InjectRepository(UserProfile) repository: Repository<UserProfile>,
  ) {
    super(repository);
  }

  public async findByAuthUserId(
    authUserId: string,
  ): Promise<UserProfile | null> {
    return this.repository.findOne({ where: { authUserId } });
  }
}
```

`TypeormRepositoryBase` (`packages/shared/src/database/typeorm-repository.base.ts`) wraps a `Repository<Entity>` and implements `RepositoryPort`: it resolves the default `relations`, logs persistence calls, throws `EntityByIdNotFoundError` / `EntityNotFoundError` from the `...OrThrow` finders, and in `save` translates a Postgres unique violation into `UniqueConstraintViolationError` and anything else into `DatabaseQueryError`.

Adapters with hand-written SQL are covered against Postgres by e2e suites under `apps/core_microservice/test/`, not only by mocked unit specs: `chat.repository.ts`, `message.repository.ts`, `post-like.repository.ts`, `typeorm-outbox.adapter.ts`, `post.repository.ts` (LATERAL keyset feed), `comment.repository.ts` (recursive CTEs for reply trees), `upload.repository.ts` (`FOR UPDATE SKIP LOCKED` claim) and `user-profile.repository.ts` (`lower(username) LIKE … ESCAPE`). Query-shape rules are in §3.15.

Two repositories can serve one table with different visibility. `AssetRepository` overrides `prepareQuery` and `findOneByIdOrThrow` so that every inherited read sees only `READY` assets, while `UploadRepository` (behind `UPLOAD_REPOSITORY`) also sees `PENDING` ones. Code that attaches assets therefore can't pick up an unconfirmed upload by accident.

#### Layer 6: Service

Services orchestrate: load through ports, call entity methods, persist, write outbox rows, then after the commit emit realtime events and invalidate cache entries (§3.14), and log. They contain no business rules, and they receive the caller's id (`user.sub`) as an argument. A flow that spans storage and the database without a shared transaction compensates instead: `UploadsService.confirm` deletes the copied object if the row save fails (§3.13). Services that count outcomes define their metric on `METRICS_REGISTRY` (§8.3).

```typescript
// apps/core_microservice/src/modules/comments/comments.service.ts
@Injectable()
export class CommentsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(COMMENT_REPOSITORY) private readonly commentRepository: ICommentRepository,
    @Inject(POST_REPOSITORY) private readonly postRepository: IPostRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: IOutboxPort,
    @Inject(USER_DIRECTORY_PORT) private readonly userDirectory: IUserDirectoryPort,
  ) {}
```

The logger is `@Inject(LoggerKey) logger: Logger` and needs `LoggerModule.forFeature('<Name>')` in the module's imports; log with `this.logger.debug('Comment created', { props: { commentId } })`. The context is per module, not per class (`UploadsService` logs as `'AssetsService'`). `PendingUploadSweeper` and `S3StorageAdapter` use Nest's `new Logger(...)` instead; don't copy that.

#### Layer 7: Controller

Controllers map HTTP to service calls and entities to response DTOs. They inject **services only**, never repositories or ports.

```typescript
// apps/core_microservice/src/modules/chats/messages.controller.ts
@ApiTags("chats")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("chats/:chatId/messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Patch(":messageId")
  @ApiOperation({ summary: "Edit your own message" })
  edit(
    @CurrentUser("sub") userId: string,
    @Param("chatId", ParseUUIDPipe) chatId: string,
    @Param("messageId", ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messagesService.edit(userId, chatId, messageId, dto);
  }
}
```

Route ids go through `ParseUUIDPipe`; status codes other than the default use `@HttpCode` (or `@Res({ passthrough: true })` when it depends on the result, as `POST /chats/:chatId/messages` does for 201 vs 200 on a replay). `UploadsController` is the example of an idempotent action: `POST /uploads` answers 201 with a ticket, `POST /uploads/:uploadId/confirm` answers 200 and returns the same body when called again. File bytes never pass through a controller: `POST /assets/upload` and `POST /chats/attachments` (multipart) were removed with the two-step upload flow, and core no longer uses multer.

#### Layer 8: Module

```typescript
// apps/core_microservice/src/modules/posts/posts.module.ts
@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostLike, PostAsset]),
    LoggerModule.forFeature("PostsService"),
    AssetsModule, // exports AssetsService (checks post images)
  ],
  controllers: [PostsController],
  providers: [
    PostsService,
    PostRepository,
    { provide: POST_REPOSITORY, useExisting: PostRepository },
  ],
  exports: [POST_REPOSITORY],
})
export class PostsModule {}
```

Every module lists its entities in `TypeOrmModule.forFeature([...])` (the root uses `autoLoadEntities: true`) and is imported by `apps/core_microservice/src/app.module.ts`. The feed no longer needs `FollowsModule`: `findFeedPage` joins `follows` in SQL. `ProfileSummaryCache` and `METRICS_REGISTRY` come from global modules (§3.4), so they need no import.

### 3.3 The DI Rule: Ports Bound to Symbol Tokens

**Every port is an interface plus a `Symbol` token in `domain/interfaces/`. The module binds the token to an adapter; consumers inject by token and type the field as the interface.**

```typescript
// 1. Port + token (domain/interfaces/comment-repository.port.ts)
export interface ICommentRepository extends RepositoryPort<Comment, CommentProps> { ... }
export const COMMENT_REPOSITORY = Symbol.for('ICommentRepository');

// 2. Binding (comments.module.ts)
providers: [
  CommentsService,
  CommentRepository,
  { provide: COMMENT_REPOSITORY, useExisting: CommentRepository },
],
exports: [COMMENT_REPOSITORY],

// 3. Injection (any service in a module that imports CommentsModule)
@Inject(COMMENT_REPOSITORY) private readonly commentRepository: ICommentRepository,
```

`useClass` vs `useExisting`:

- `{ provide: TOKEN, useClass: Adapter }` when only the token is needed (`CHAT_REPOSITORY`, `MESSAGE_REPOSITORY`, `ATTACHMENT_STORAGE_PORT`, `POST_LIKE_REPOSITORY`, `COMMENT_LIKE_REPOSITORY`, `USER_DIRECTORY_PORT`, `AVATAR_ASSET_PORT`, `FileStoragePortKey`, `UPLOAD_REPOSITORY`, `CONTENT_SNIFFER`, `CACHE_STORE`, `OUTBOX_PORT`, `EVENT_BUS`).
- `{ provide: TOKEN, useExisting: Adapter }` plus the adapter class as its own provider when the same instance must be reachable both ways. `CHAT_REALTIME_PORT` → `ChatsGateway` needs this: Nest must instantiate the gateway as a gateway, and services must reach that same instance through the port. Repositories bound this way (`POST_REPOSITORY`, `COMMENT_REPOSITORY`, `FollowRepositoryKey`, `UserProfileRepositoryKey`) are still injected by token, except in `ProfilesService` (table below).

Use `Symbol.for('IName')` for new tokens. A few tokens use a plain `Symbol('IName')` (`UPLOAD_REPOSITORY`, `POST_LIKE_REPOSITORY`, `COMMENT_LIKE_REPOSITORY`, `OUTBOX_PORT`); that works because every consumer imports the same constant, but don't copy it. Export the token (not the adapter) when another module needs the port, as `PostsModule` exports `POST_REPOSITORY`.

In tests the token makes faking trivial: `{ provide: POST_REPOSITORY, useValue: { findById: jest.fn(), save: jest.fn() } }` plus `{ provide: LoggerKey, useValue: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }`. Services that invalidate caches also need `{ provide: ProfileSummaryCache, useValue: { invalidateProfile: jest.fn(), invalidateCounts: jest.fn() } }`.

Some services inject concrete classes instead of ports. Don't copy these:

| Service                 | Concrete dependency                            | Note                                                          |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `ProfilesService`       | `UserProfileRepository`, `ProfileSummaryCache` | the cache is a typed wrapper over `CACHE_STORE` (§3.14)       |
| `AssetsService`         | `AssetRepository`                              | READY-only repository (Layer 5)                               |
| `PostsService`          | `AssetsService`, `ProfileSummaryCache`         | posts calls `Asset` methods on another module's entity (§3.4) |
| `FollowsService`        | `ProfileSummaryCache`                          | cache invalidation only                                       |
| `ProfileSummaryService` | `ProfilesService`, `ProfileSummaryCache`       | read model composed from other modules (§3.4)                 |

Adapters may wrap another module's exported service class: `AttachmentStorageAdapter` and `AvatarAssetAdapter` inject `AssetsService`, which is the module-local-port pattern of §3.4. `InternalEventsController` calls `ProfilesService` directly; `ChatsGateway` is injected as a class by `SessionRevocationListener` (same module). Everything else goes through tokens.

### 3.4 Module Map and Cross-Module Ports

| Module                | Owns                                                                                                                                                                                                                                                   | Exposes to other modules                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `profiles`            | `UserProfile`, profile search, by-ids lookup, lazy profile creation, avatar rules (`AVATAR_ASSET_PORT` over `AssetsService`); invalidates the cached profile after a save                                                                              | `ProfilesService`, `USER_DIRECTORY_PORT`                                                 |
| `profile-summary`     | `GET /profiles/by-user/:userId`: a cache-aside read model (profile + follower/following/published-post counts from the cache, `isFollowedByMe` always live, §3.14). Separate module because follows imports profiles, so profiles can't import follows | —                                                                                        |
| `posts`               | `Post`, `PostLike` and `PostAsset` entities, keyset feed (§3.12), search, posts by author; checks post images through `AssetsService`; invalidates the author's cached counts on delete/publish/archive                                                | `POST_REPOSITORY`                                                                        |
| `comments`            | `Comment`, `CommentLike` entities; reply trees of any depth, paged by root comment; deleting a comment soft-deletes its whole subtree (`softDeleteWithReplies`)                                                                                        | `COMMENT_REPOSITORY`                                                                     |
| `likes`               | like/unlike routes and the like repositories (entities belong to posts/comments)                                                                                                                                                                       | —                                                                                        |
| `follows`             | `Follow`; paged followers/following with `isFollowedByMe`; invalidates both users' cached counts after commit                                                                                                                                          | `FollowsService` (unused elsewhere), `FollowRepositoryKey` (used by profile-summary)     |
| `assets`              | `Asset`, two-step uploads `POST /uploads` + `/confirm` (§3.13), content sniffing, the pending-upload sweeper, S3 storage (SeaweedFS locally), presigned GET and POST                                                                                   | `AssetsService` (READY-only `findByIds`, `softDeleteMany`, `presignGet`, `deleteObject`) |
| `chats`               | `Chat`, `ChatParticipant`, `Message`, `MessageAttachment`, `ChatsGateway`; no upload route (files come from `/uploads` with purpose `chat-attachment`); signed-URL cache                                                                               | `CHAT_REALTIME_PORT`                                                                     |
| `internal-events`     | `POST /internal/events/user-created`                                                                                                                                                                                                                   | —                                                                                        |
| `notifications-relay` | AMQP consumer for `notification.*` → sockets                                                                                                                                                                                                           | —                                                                                        |

Global infrastructure (no import needed): `AppConfigModule` (`AppConfigService`), `RedisModule` (`REDIS_CLIENT`), `CommonAuthModule` (`ACCESS_TOKEN_VERIFIER`), `MessagingModule` (`OUTBOX_PORT`, `EVENT_BUS`, `AMQP_CONNECTION`), `CacheModule` (`CACHE_STORE`, `ProfileSummaryCache`, `CACHE_REDIS_CLIENT`, §3.14), `MetricsModule` (`METRICS_REGISTRY`, §8). `ObservabilityModule` registers the health and metrics controllers, `InternalTokenGuard`, the checks and `HEALTH_CHECKS`; it exports nothing and is not global. `app.module.ts` also wires two things around every request: `QueryContextMiddleware` (all routes) and `QueryCountInterceptor` as an `APP_INTERCEPTOR` (§3.15).

**`USER_DIRECTORY_PORT`** is how other modules read user profiles without touching profile tables:

```typescript
// apps/core_microservice/src/modules/profiles/domain/interfaces/user-directory.port.ts
export interface IUserDirectoryPort {
  /** Unknown ids are simply absent from the returned map. */
  getUsers(userIds: string[]): Promise<Map<string, IChatUser>>;
  /** @throws UserNotFoundError listing the ids that have no profile. */
  assertUsersExist(userIds: string[]): Promise<void>;
}
export const USER_DIRECTORY_PORT = Symbol.for("IUserDirectoryPort");
```

`UserDirectoryAdapter` (`apps/core_microservice/src/modules/profiles/infrastructure/user-directory.adapter.ts`) does one `IN` query per call. Chats uses it for participant snapshots and member validation, comments/likes/follows/messages for the actor snapshot in broker events, and the gateway for the typing user. A module that needs it imports `ProfilesModule`.

The same idea applies to storage: chats never touches `Asset` directly. `ATTACHMENT_STORAGE_PORT` is bound to `AttachmentStorageAdapter` (`apps/core_microservice/src/modules/chats/infrastructure/storage/attachment-storage.adapter.ts`), which wraps the exported `AssetsService` (READY assets only) and caches presigned URLs in `CACHE_STORE`. Profiles does the same through `AVATAR_ASSET_PORT`. **Rule: another module reaches assets through a port of its own over `AssetsService`.** Posts is the exception: `PostsService` injects `AssetsService` and calls `Asset.assertAttachableTo` itself.

Attach rules come from two places today. Posts use `Asset.assertAttachableTo(target, userId)` (READY, owned by the caller, purpose fits the target). Avatars call it for READY and purpose only (the adapter passes the uploader as the user), and `UserProfile.changeAvatar` checks ownership. Chats checks ownership and `visibility === 'PRIVATE'` in `Message.create` over the snapshot the port returns.

### 3.5 Transactional Repository Ports

When a use case writes several rows that must commit together (a message plus its attachments plus outbox rows; a like plus its outbox row), the port exposes `runInTransaction` and each write takes an optional transaction handle:

```typescript
// apps/core_microservice/src/modules/chats/domain/interfaces/chat-repository.port.ts
/** Opaque transaction handle passed between the chat and message ports. */
export type ChatTransaction = EntityManager;

export interface IChatRepository {
  save(chat: Chat, tx?: ChatTransaction): Promise<Chat>;
  advanceReadSeq(
    chatId: string,
    userId: string,
    seq: number,
    tx?: ChatTransaction,
  ): Promise<number>;
  runInTransaction<T>(work: (tx: ChatTransaction) => Promise<T>): Promise<T>;
  // ...
}
```

The service opens the transaction through the port and passes `tx` to every write, including `IOutboxPort.add(routingKey, payload, tx)`, which **requires** the caller's transaction:

```typescript
// apps/core_microservice/src/modules/likes/likes.service.ts
await this.postLikes.runInTransaction(async (tx) => {
  const { inserted } = await this.postLikes.like(postId, userId, tx);
  if (inserted && post.notifiesAuthorOfLikeBy(userId)) {
    await this.outbox.add(RoutingKeys.POST_LIKED, payload, tx);
  }
});
```

The same shape is used by `ICommentRepository` (`CommentTransaction`), `IFollowRepository`, `IPostLikeRepository` and `ICommentLikeRepository`; `IMessageRepository` has no `runInTransaction` of its own and takes the chat repository's `tx` in every write. The handle also crosses into assets: `IAttachmentStoragePort.findAssets(ids, tx?)` and `softDeleteAssets(ids, tx)` pass it on to `AssetsService.findByIds` / `softDeleteMany`, so a message send or delete and its attachment rows commit together. `IPostRepository`, `IUserProfileRepository` and `IUploadRepository` have no `runInTransaction`: their writes are single statements, `claimSweepable` opens a short transaction inside the adapter, and `UploadsService.confirm` spans storage and the database and compensates instead (§3.13). Adapters implement `save(e, tx?)` as "`tx.getRepository(E).save(e)` when given, else the base `save`"; inside a transaction raw errors propagate and the service's wrapper maps non-domain errors to `DatabaseQueryError`.

**Why `EntityManager` in a domain port is accepted.** The handle type is TypeORM's, so the domain layer technically knows its ORM. The alternative, a unit-of-work abstraction over every adapter plus the outbox, would add a layer for no practical gain: TypeORM is the only persistence used, entities are already TypeORM entities, and the domain code only passes the handle along and never calls it. The alias (`ChatTransaction`, `CommentTransaction`) keeps call sites readable and gives one place to change if that ever stops being true.

**After the commit, never inside it:** realtime emits (§3.8) and cache invalidation (§3.14). A key deleted inside the transaction can be re-cached from the pre-commit state by a concurrent reader.

Rules for chats sequence and read-pointer columns: never persist `chats.lastSeq` or a participant's `lastReadSeq`/`joinedSeq` through a cascading `chats.save(chat)`, because the graph was loaded outside the row lock and a save can rewind a concurrent `allocateSeq`. Use the narrow writes on the port: `allocateSeq` (also for `changeSeq`), `advanceReadSeq`, `findByIdForUpdate`, `upsertActiveMember`, `markParticipantLeft`, `setParticipantRole`, `setTitle`.

### 3.6 Authentication, `@CurrentUser` and IDOR

**Guard.** `JwtAuthGuard` (`apps/core_microservice/src/common/guards/jwt-auth.guard.ts`) delegates to the shared `AccessTokenVerifier`, injected by the `ACCESS_TOKEN_VERIFIER` token from the global `CommonAuthModule` (`apps/core_microservice/src/common/auth/common-auth.module.ts`):

```typescript
// apps/core_microservice/src/common/guards/jwt-auth.guard.ts
const result = await this.verifier.verify(this.extractTokenFromHeader(request));
if (!result.ok) {
  switch (result.reason) {
    case "missing":
      throw new UnauthorizedException("Authentication token is missing");
    case "revoked":
      throw new UnauthorizedException("Token has been revoked");
    case "unavailable":
      throw new ServiceUnavailableException(
        "Unable to verify token status, try again later",
      );
    default:
      throw new UnauthorizedException(
        "Invalid or expired authentication token",
      );
  }
}
request["user"] = result.payload; // { sub, email, jti, sid?, exp }
```

`AccessTokenVerifier` (`packages/shared/src/auth/access-token.verifier.ts`) verifies HS256 with `JWT_SECRET` (the secret auth signs with; there is no `JWT_ACCESS_SECRET`), requires `jti`, `sub` and `exp`, then checks Redis `blacklist:access:<jti>`. If Redis throws, the result is `unavailable` and the guard **fails closed with 503**. The provider (`apps/core_microservice/src/common/auth/access-token-verifier.provider.ts`) gets the secret from `AppConfigService.jwtSecret`, so a missing `JWT_SECRET` stops startup in env validation. Because `CommonAuthModule` and `RedisModule` are global, any module can use `@UseGuards(JwtAuthGuard)` without extra imports.

`OptionalJwtAuthGuard` (`apps/core_microservice/src/common/auth/optional-jwt-auth.guard.ts`) is for public routes that personalise the response (`GET /posts/:id`, `/posts/search`, `/comments/post/:postId` compute `likedByMe`; `/posts/author/:userId` shows drafts to their author; `/profiles/by-user/:userId` and `/follows/:userId/followers|following` compute `isFollowedByMe`): any failure leaves `request.user` unset and the request continues anonymously.

**`@CurrentUser()`** (`apps/core_microservice/src/common/decorators/current-user.decorator.ts`) returns `request.user`, or one field: `@CurrentUser('sub') userId: string`.

**IDOR.** Every mutating route uses `JwtAuthGuard` and passes `user.sub` into the service; the check that the caller owns or may touch the resource happens before the mutation. Where it lives today:

| Module                | Check                                                                                                                                                                                                                               | Throws                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| chats                 | entity methods: `Chat.assertCanRead/assertCanPost` (non-members get 404, so chat ids don't leak), `Chat` admin checks, `Message.edit/delete`                                                                                        | `ChatNotFoundError` (404), `NotChatAdminError` / `NotMessageAuthorError` (`AccessDeniedError`, 403) |
| likes                 | `Post.assertLikeableBy`, `Comment.assertLikeableBy` (an unpublished post is visible to its author only)                                                                                                                             | `EntityByIdNotFoundError` (404)                                                                     |
| follows               | scoped by construction: the follower is always `user.sub`                                                                                                                                                                           | —                                                                                                   |
| posts, comments       | service compares `authorId !== userId`                                                                                                                                                                                              | Nest `ForbiddenException` (403)                                                                     |
| profiles              | `UserProfile.assertOwnedBy` (called from `ProfilesService.updateProfile`), `UserProfile.changeAvatar` (asset must be the owner's, public, a non-SVG image); `AvatarAssetAdapter` also requires the `avatar` or `post-image` purpose | `NotProfileOwnerError`, `AvatarAssetNotOwnedError` (`AccessDeniedError`, 403)                       |
| posts (by author)     | `Post.assertStatusListableBy`: non-published statuses are listed for the author only                                                                                                                                                | `PostStatusNotVisibleError` (`AccessDeniedError`, 403)                                              |
| uploads confirm       | `UploadsService.confirm` / `Asset.assertConfirmableBy`: someone else's upload looks exactly like an unknown id                                                                                                                      | `EntityByIdNotFoundError` (404)                                                                     |
| posts with `assetIds` | `PostsService` + `Asset.assertAttachableTo('post', userId)`: missing, unconfirmed and foreign ids all read as 404; a wrong purpose is 400                                                                                           | `EntityByIdNotFoundError` (404), `AssetNotAttachableError` (400)                                    |
| chat attachments      | `Message.create`: missing or foreign assets share one reason, non-private assets are refused                                                                                                                                        | `InvalidAttachmentError` (400)                                                                      |

Ownership is checked on the root of an operation, not on everything it touches: deleting your own comment soft-deletes the whole reply subtree, including other users' replies.

New code follows the chats pattern: an entity method such as `assertOwnedBy(userId)` throwing an `AccessDeniedError` subclass, called from the service (§10 steps 3, 4 and 8). Where existence itself is private (chats, uploads), answer 404 for both "missing" and "not yours".

### 3.7 App-Level Bootstrap (`main.ts`)

```typescript
// apps/core_microservice/src/main.ts (excerpt)
const app = await NestFactory.create(AppModule, { logger: new WinstonLogger('CoreSystem') });
app.use(requestIdMiddleware());                       // first: every later log line carries the id (§8.6)
app.use(accessLogMiddleware(new WinstonLogger('Http')));
app.use(helmet());
const registry = app.get<Registry>(METRICS_REGISTRY);
app.use(httpMetricsMiddleware(registry)); // before routing; reads the route template on `finish` (§8.3)
app.use(cookieParser());
app.enableCors({
  origin: appConfig.clientUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
});
const appConfig = app.get(AppConfigService);
appConfig.assertSafeForEnvironment(); // PERF_INSTRUMENTATION=true is refused when NODE_ENV=production
appConfig.assertInternalApiToken();   // INTERNAL_API_TOKEN set and 32+ chars, else boot fails
registerDbPoolGauge(registry, () => /* pg pool of dataSource.driver.master */);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.useGlobalFilters(new DomainExceptionFilter(createErrorsCounter(registry))); // counts errors_total (§8.3)
if (appConfig.swaggerEnabled) setupSwagger(app); // /api, off by default in production (SWAGGER_ENABLED)
app.enableShutdownHooks(); // runs onModuleDestroy/onApplicationShutdown (outbox relay, sweeper, AMQP, Redis)
await app.listen(appConfig.port); // CORE_PORT, default 3001
```

`createE2eApp` in `apps/core_microservice/test/helpers/app.helpers.ts` repeats the request-facing part of this wiring: the metrics middleware, the pool gauge, `ValidationPipe` and `DomainExceptionFilter`. It skips the request-id and access-log middleware, helmet, cookies, CORS, Swagger, shutdown hooks and the two asserts. Older suites boot `AppModule` with only the pipe and filter. Keep the pipe and filter in sync with `main.ts`.

Configuration goes through `AppConfigService` (`apps/core_microservice/src/config/app-config.service.ts`), never `process.env`. `AppConfigModule` validates the environment at bootstrap (`config/env.validation.ts`, `class-validator`): every required variable and every invalid value is reported by name (never its value), and an empty value counts as unset. `SLOW_QUERY_MS`, `CACHE_REDIS_PORT`, the `UPLOAD_*` values, `OUTBOX_MAX_ATTEMPTS` and `S3_PORT` throw on invalid values when first read (`positiveInt` / `nonNegativeInt` and their own checks). `CORE_PORT`, `POSTGRES_PORT` and `REDIS_PORT` are only `parseInt`-ed and are not validated.

| Getter                               | Variables (default)                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`                               | `CORE_PORT` (3001)                                                                                                                                      |
| `postgres`                           | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DB_NAME_CORE`                                                                  |
| `redis`                              | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (sessions and blacklists)                                                                                  |
| `cacheRedis`                         | `CACHE_REDIS_HOST` (localhost), `CACHE_REDIS_PORT` (6380) (§3.14)                                                                                       |
| `rabbitmq`                           | `RABBITMQ_URL` (required)                                                                                                                               |
| `outbox`                             | `OUTBOX_MAX_ATTEMPTS` (10)                                                                                                                              |
| `s3`                                 | `S3_ENDPOINT`, `S3_PORT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_PRIVATE_BUCKET_NAME`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_USE_SSL` |
| `uploads`                            | `UPLOAD_LINK_TTL_SEC` (300), `UPLOAD_SWEEP_GRACE_SEC` (3600), `UPLOAD_SWEEP_INTERVAL_SEC` (900) (§3.13)                                                 |
| `perfInstrumentation`, `slowQueryMs` | `PERF_INSTRUMENTATION` (off), `SLOW_QUERY_MS` (200) (§3.15)                                                                                             |
| `internalApiToken`                   | `INTERNAL_API_TOKEN` (required, 32+ chars, §8.4)                                                                                                        |
| `jwtSecret`, `clientUrl`             | `JWT_SECRET` (required), `CLIENT_URL`                                                                                                                   |
| `swaggerEnabled`                     | `SWAGGER_ENABLED` (on unless `NODE_ENV=production`)                                                                                                     |

Known exceptions that read `process.env` directly: `notifications-relay.consumer.ts` (`NOTIFICATIONS_RELAY_QUEUE`) and `apps/core_microservice/src/database/database.config.ts` (CLI and seeds run without Nest).

### 3.8 Realtime: `ChatsGateway` as an Inbound and Outbound Adapter

`ChatsGateway` (`apps/core_microservice/src/modules/chats/infrastructure/realtime/chats.gateway.ts`) is the Socket.IO adapter on the `/realtime` namespace (`REALTIME_NAMESPACE`). Like a controller it is an **inbound** adapter for client-to-server events; it is also the **outbound** adapter behind `CHAT_REALTIME_PORT`.

**Handshake.** `afterInit` installs `createSocketAuthMiddleware(verifier)` (`apps/core_microservice/src/modules/chats/infrastructure/realtime/socket-auth.middleware.ts`). It reads the token from `handshake.auth.token` only (a query-string token would end up in logs), verifies it with the same `AccessTokenVerifier`, and fills `socket.data`:

```typescript
socket.data = { userId: sub, sid: sid ?? null, jti, exp, viewingChatId: null };
```

A rejected handshake gets an `unauthorized` or `unavailable` connect error. On connect the socket joins `user:{userId}` and `chat:{chatId}` for every active participation (`userRoom()` / `chatRoom()` helpers), and an expiry timer emits `session:expired { reason: 'expired' }` and disconnects at `exp`. `auth:renew` swaps in a fresh token and reschedules the timer; it is rejected when `sub` changes or when the socket has a `sid` and the new token's differs.

**Inbound handlers.** `chat:view`, `typing:start`, `typing:stop`, `auth:renew`. **Every client-to-server handler calls `ensureSessionActive` first**, so a revocation missed on pub/sub is still caught:

```typescript
@SubscribeMessage('typing:start')
async handleTypingStart(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() body: unknown) {
  if (!(await this.ensureSessionActive(socket))) return; // EXISTS blacklist:access:<jti>
  // ...
}
```

`ensureSessionActive` emits `session:expired` and disconnects a revoked socket, and acks `unavailable` when Redis is down (fail closed). Membership for typing is `socket.rooms.has(chat:{id})`, with no DB query.

**Outbound port.** Services never import the gateway:

```typescript
// apps/core_microservice/src/modules/chats/domain/interfaces/chat-realtime.port.ts
export interface IChatRealtimePort {
  emitToChat<E extends ChatRealtimeEvent>(chatId: string, event: E, payload: ChatRealtimePayload<E>): void;
  emitToUser<E extends ChatRealtimeEvent>(userId: string, event: E, payload: ChatRealtimePayload<E>): void;
  joinUserToChat(userId: string, chatId: string): void;
  removeUserFromChat(userId: string, chatId: string): void;
  isUserViewingChat(userId: string, chatId: string): boolean;
  emitTypingStopped(chatId: string, user: IChatUser): void;
}
export const CHAT_REALTIME_PORT = Symbol.for('IChatRealtimePort');

// chats.module.ts
ChatsGateway,
{ provide: CHAT_REALTIME_PORT, useExisting: ChatsGateway },
```

**Emit after commit.** Services emit only after `runInTransaction` resolves, inside a try/catch that logs a warning: a failed emit never fails the request, and clients recover through `GET /chats/:chatId/messages/changes` on reconnect.

```typescript
// apps/core_microservice/src/modules/chats/messages.service.ts (edit)
const message = await this.chats.runInTransaction(async (tx) => {
  const found = await this.loadOwnVisible(me, chatId, messageId, tx);
  const changeSeq = await this.messages.allocateSeq(chatId, tx);
  found.edit(me, dto.content, changeSeq);
  return this.messages.update(found, tx);
});
const [response] = await this.toResponses([message]);
this.emitToChat(chatId, "message:updated", { message: response }); // post-commit, guarded
```

Single-instance limitation: rooms live in the in-memory adapter (no socket.io Redis adapter), and `isUserViewingChat` only sees local sockets.

### 3.9 Error Flow on the Socket

Domain errors thrown from a gateway handler go through `WsDomainExceptionFilter` (Layer 3 table, last paragraph). Handlers that ack use the `IRealtimeAckError` shape from `@repo/contracts`.

### 3.10 Session Revocation: `auth:session-revoked`

On logout, auth blacklists the tokens and then publishes a `SessionRevokedEvent { userId, sid | null, jti | null, revokedAt }` on the Redis channel `RedisKeys.sessionRevokedChannel` (`'auth:session-revoked'`). Core's `SessionRevocationListener` (`apps/core_microservice/src/common/redis/session-revocation.listener.ts`) subscribes on a duplicated connection (subscriber mode can't run other commands), validates the message with `class-validator`, and closes the matching sockets in the user's room:

```typescript
const sockets = await this.gateway.server.in(userRoom(userId)).fetchSockets();
for (const socket of sockets) {
  const matches = sid ? socket.data.sid === sid : socket.data.jti === jti;
  if (!matches) continue;
  socket.emit("session:expired", { reason: "revoked" });
  socket.disconnect(true);
}
```

Pub/sub is not durable. A lost message is bounded by `ensureSessionActive` on the next client event and by the expiry timer. A failed subscribe at boot is logged and boot continues. The listener is registered in `ChatsModule`.

### 3.11 Outbox → RabbitMQ → Notifications → Relay

Core never publishes to the broker inside a request. It writes an **outbox row** in the same transaction as the business change, and a relay publishes it later (at-least-once).

```
service tx ──▶ outbox_events row ──▶ OutboxRelay ──▶ EVENT_BUS (AmqpEventBus, confirm channel)
                                                       │  exchange innogram.events (topic)
                                                       ▼
                    notifications.events (social.#, chat.message.alerted) ──▶ notifications service
                                                       │  notification.created / notification.seen
                                                       ▼
                    core.realtime-relay (notification.#) ──▶ NotificationsRelayConsumer ──▶ emitToUser(user:{id})
```

Files, all under `apps/core_microservice/src/common/messaging/`:

| Piece                                              | File                        | Role                                                                                                                                                  |
| -------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IOutboxPort` / `OUTBOX_PORT`                      | `outbox.port.ts`            | `add(routingKey, payload, tx)` for services; `claimPending`, `markPublished`, `markFailed`, `recordError`, `markDead`, `purgePublished` for the relay |
| `TypeOrmOutboxAdapter`                             | `typeorm-outbox.adapter.ts` | `FOR UPDATE SKIP LOCKED` claim, post-commit wake signal                                                                                               |
| `OutboxEvent`                                      | `outbox-event.entity.ts`    | table `outbox_events` (`attempts`, `lastError`, `publishedAt`, `deadLetteredAt`)                                                                      |
| `EventBusPort` / `EVENT_BUS`, `EventRejectedError` | `event-bus.port.ts`         | publish an `EventEnvelope`; resolves on broker confirm                                                                                                |
| `AmqpEventBus`                                     | `amqp-event-bus.ts`         | amqp-connection-manager confirm channel, 10 s timeout                                                                                                 |
| `OutboxRelay`                                      | `outbox-relay.ts`           | 500 ms poll + wake, batch 100, backoff 1 s → 30 s, hourly purge of rows published over 7 days ago                                                     |
| `MessagingModule`                                  | `messaging.module.ts`       | `@Global()`; exports `OUTBOX_PORT`, `EVENT_BUS`, `AMQP_CONNECTION`                                                                                    |

**Failure rules in the relay.** A broker-side failure (broker down, nack, confirm timeout, closed channel) only records `lastError` (`recordError`) and backs off; it never counts toward dead-lettering, so an outage of any length can't kill healthy rows. Only `EventRejectedError` (the event itself can't be published, e.g. its payload can't be serialized) counts: `markFailed` bumps `attempts`, and at `OUTBOX_MAX_ATTEMPTS` (env, default 10, `AppConfigService.outbox.maxAttempts`) the row is `markDead` (sets `deadLetteredAt`), logged at error level and skipped. The relay lives in the non-global `OutboxRelayModule` so it stops and finishes its drain before the AMQP providers close.

**Envelope and payloads** come from `@repo/shared` (`packages/shared/src/events/event-envelope.ts`): `EventEnvelope<T> { eventId (= outbox row id), type (= routing key), version: 1, occurredAt, payload }`, `EXCHANGE_NAME = 'innogram.events'`, `RoutingKeys` (`social.post.commented`, `social.post.liked`, `social.comment.liked`, `social.user.followed`, `chat.message.alerted`, `notification.created`, `notification.seen`). Payload classes carry `class-validator` decorators because consumers validate them.

**Producers.** `CommentsService`, `LikesService`, `FollowsService` (social events, one row per notification-worthy action) and `MessagesService.send` (one `chat.message.alerted` row per active participant who isn't the author and isn't viewing the chat; the same set gets a `chat:alert` socket event after commit).

**Back into core.** `NotificationsRelayConsumer` (`apps/core_microservice/src/modules/notifications-relay/notifications-relay.consumer.ts`) binds `core.realtime-relay` to `notification.#` on its own channel of `AMQP_CONNECTION` and turns `notification.created` into `notification:new` and `notification.seen` into `notifications:seen` via `CHAT_REALTIME_PORT.emitToUser`. It stores nothing. `NOTIFICATIONS_RELAY_QUEUE` overrides the queue name (a non-default name is declared non-durable and auto-delete; e2e suites use one per run).

### 3.12 Pagination and List Endpoints

Every list is bounded. `limit` is validated in the query DTO against `PAGE_SIZE_MAX` (50) from `@repo/contracts`, or `CHANGES_PAGE_SIZE_MAX` (200) for `GET /chats/:chatId/messages/changes`. Zero, negative, non-numeric or above-maximum values are a **400, never clamped**. Defaults are per endpoint:

| Default `limit` | Endpoints                                           |
| --------------- | --------------------------------------------------- |
| 20              | feed, post search, posts by author, comments, chats |
| 50              | followers, following, messages                      |
| 10              | profile search                                      |
| 200             | message changes                                     |

```typescript
// apps/core_microservice/src/modules/posts/dto/feed-query.dto.ts
export class FeedQueryDto implements IFeedQuery {
  @IsOptional()
  @IsFeedCursor()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  limit: number = 20;

  /** Declared only so `whitelist` keeps it and validation can reject it. */
  @Equals(undefined, { message: "page is not supported; use cursor" })
  page?: unknown;
}
```

The last property is how a removed parameter is retired: the global `ValidationPipe` would silently strip an undeclared `page`, so the DTO declares it and rejects any value.

| Envelope                                                         | Shape                                                                               | Used by                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `IOffsetPage<T>` (`packages/contracts/src/common/pagination.ts`) | `{ items, page, limit, hasMore }`; `hasMore` from fetching `limit + 1`, no `COUNT`  | comments (`GET /comments/post/:postId`), followers, following |
| `IFeedPage`                                                      | `{ items, nextCursor }` (`null` on the last page)                                   | `GET /posts/feed`                                             |
| `ICursorPage<T>`                                                 | `{ items, hasMore }`, cursor in the query (`before`, `beforeSeq`, `afterChangeSeq`) | chats, messages, message changes                              |
| legacy offset with `total`                                       | `{ items, total, page, limit }` (+ `hasMore` for by-author)                         | `GET /posts/search`, `GET /posts/author/:userId`              |
| `IPaginatedResponse` / `PAGINATION_DEFAULTS`                     | unused legacy exports; their `MAX_LIMIT: 100` does not apply                        | —                                                             |

New lists use `IOffsetPage` or a cursor, not `total`.

**Keyset cursor (feed).** `FeedCursor` (`apps/core_microservice/src/modules/posts/domain/feed-cursor.ts`) is a domain value object: version `v: 1`, the raw Postgres timestamp text with microseconds (`t`, never a JS `Date`, which would truncate to milliseconds and skip rows) and the row `id`, encoded as base64url JSON. Each layer has one job:

- The repository builds the next cursor from the last row (`FeedCursor.fromRow(last).encode()`) and filters with `(p."createdAt", p.id) < ($3::timestamptz, $4::uuid)`.
- `@IsFeedCursor()` (`posts/dto/is-feed-cursor.validator.ts`) rejects a malformed cursor in the DTO (`FeedCursor.decode(s) !== null`).
- The service decodes it and passes the `FeedCursor` to `findFeedPage`.

The order is always `createdAt DESC, id DESC`, which is stable even when two rows share a timestamp. A matching index backs it (`IDX_posts_feed`, partial on published and not deleted). Notifications uses the same idea with its own codec (§5).

**Comment threads.** Replies may nest to any depth (`Comment.create` accepts any parent). `GET /comments/post/:postId` pages **root comments** (`findRootPage`, `limit + 1`). It then loads every live descendant of those roots in one recursive CTE (`findRepliesOf`) and returns roots followed by their replies. A soft-deleted comment stops the walk, and `softDeleteWithReplies` deletes a comment's whole subtree in one statement. Comment counts on posts include replies.

Every new list endpoint gets a DTO spec that checks out-of-range limits are rejected and not clamped (e.g. `profiles/dto/search-profiles-query.dto.spec.ts`), plus a row in the endpoint table of `apps/core_microservice/test/pagination.e2e-spec.ts`.

### 3.13 Uploads and the Asset Lifecycle

File bytes never pass through core. An upload is two calls plus a direct upload to object storage:

```
POST /uploads { purpose, contentType, size, fileName? }
   → Asset.createPending (PENDING, private bucket, key pending/{uploaderId}/{id}, expiresAt = now + UPLOAD_LINK_TTL_SEC)
   ← IUploadTicket { uploadId, url, fields, maxBytes, expiresAt }      (presigned POST policy)
browser ── multipart POST (fields + file) ──▶ SeaweedFS
POST /uploads/:uploadId/confirm   (idempotent: a READY upload returns the same body)
   → HEAD size check → sniff first 4100 bytes (pinned to the ETag) → copy to the final key → delete the pending object
   → Asset.confirm (READY; post-image/avatar become PUBLIC in the public bucket, chat-attachment stays PRIVATE)
   ← IAssetResponse (post-image, avatar) | IUploadedAttachment (chat-attachment)
```

`UploadsService.confirm` (`apps/core_microservice/src/modules/assets/uploads.service.ts`) runs these steps, and the rules sit on `Asset`:

| Rule                                                                       | Where                                                 | Failure                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| declared type is in `UPLOAD_ALLOWLIST[purpose]`, size ≤ `UPLOAD_MAX_BYTES` | `Asset.createPending`                                 | `UploadTypeNotAllowedError`, `UploadTooLargeError` (400)                  |
| caller owns it, it is PENDING, not past `expiresAt` + 60 s grace           | `Asset.assertConfirmableBy`                           | 404 for a foreign id, `UploadNotPendingError`, `UploadExpiredError` (400) |
| stored object exists and its real size is in range                         | `UploadsService` + `Asset.assertStoredSizeAcceptable` | `UploadNotReadyError`; oversize is rejected                               |
| the bytes match the purpose (the declared type is only a hint)             | `IContentSniffer` (`FileTypeContentSniffer`)          | `UploadContentRejectedError` (400)                                        |
| only READY, owned assets with a fitting purpose are attached               | `Asset.assertAttachableTo(target, userId)`            | `UploadNotReadyError`, `AssetNotAttachableError` (400)                    |

A rejected upload (bad content or size) is discarded: the object is deleted and the row soft-deleted (`Asset.reject`). `uploads_total{purpose, outcome}` counts four outcomes: `confirmed`, `rejected_content`, `rejected_size` and `expired`. Replays and other errors are not counted.

**Compensation instead of a transaction.** Storage and Postgres can't share a transaction. Confirm therefore orders its steps so a failure leaves nothing behind: the copy happens before the row turns READY, and if the save fails, the copied object is deleted (`safeDelete`) before the error propagates. The ETag pin matters because the signed POST stays reusable until it expires: reads and copies use `If-Match`, so a client can't swap the bytes between the sniff and the copy (`UploadObjectChangedError` asks the client to confirm again).

**Background job: `PendingUploadSweeper`** (`apps/core_microservice/src/modules/assets/infrastructure/pending-upload.sweeper.ts`) removes PENDING rows whose link expired more than `UPLOAD_SWEEP_GRACE_SEC` ago. It also shows the shape to copy for any in-process job:

```typescript
onModuleInit(): void {
  this.timer = setInterval(() => void this.tick(), this.intervalMs);
  this.timer.unref();                       // never keeps the process alive
}
async onModuleDestroy(): Promise<void> {
  clearInterval(this.timer);
  await this.inFlight;                      // let the running tick finish
}
tick(): Promise<void> {                     // joins a running sweep; never rejects
  if (!this.inFlight) {
    this.inFlight = this.sweep().catch(/* log */).finally(() => { this.inFlight = null; });
  }
  return this.inFlight;
}
```

Each tick claims a batch with `FOR UPDATE SKIP LOCKED` (`IUploadRepository.claimSweepable`) and deletes the objects. It then hard-deletes the rows whose object is gone; a failed object delete keeps the row for the next tick.

### 3.14 Caching

Core has a cache-aside layer in `apps/core_microservice/src/common/cache/` on a **separate Redis instance** (`redis-cache`, `CACHE_REDIS_HOST`/`CACHE_REDIS_PORT`, LRU, no persistence). Session data stays in the main Redis (§3.6).

```typescript
// apps/core_microservice/src/common/cache/cache-store.port.ts
export interface ICacheStore {
  get<T>(key: string): Promise<T | null>;
  /** `ttlSec` must be a positive integer; anything else is a programming error and throws. */
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
}
export const CACHE_STORE = Symbol.for("ICacheStore");
```

**Fail-open.** The client uses `commandTimeout: 50`, `enableOfflineQueue: false` and `maxRetriesPerRequest: 0`, so a down or slow cache never blocks a request or startup. `RedisCacheAdapter` catches every store error: `get` returns `null`, `set`/`del` resolve. The failure is counted as `result="error"` and logged at most once per 10 s. Values are never logged. The only throw is a `RangeError` for an invalid TTL, which is a programming error. Callers therefore don't need a `try` around cache calls (`ProfileSummaryService` still wraps its calls defensively).

**Keys** (`cache-keys.ts`): `cache:v1:<resource>:<id>`. Bump `v1` to invalidate a whole layout.

| Key                                           | TTL                          | Holds                                         | Written by                         | Invalidated by (after commit)                                                                         |
| --------------------------------------------- | ---------------------------- | --------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cache:v1:profile:<authUserId>`               | 60 s                         | public profile fields                         | `ProfileSummaryService` on a miss  | `ProfilesService` (after create, including the lazy create, and after update)                         |
| `cache:v1:counts:<authUserId>`                | 60 s                         | follower, following and published-post counts | `ProfileSummaryService` on a miss  | `FollowsService` (both users, on follow/unfollow), `PostsService` (author, on delete/publish/archive) |
| `cache:v1:surl:<assetId>:<hash(disposition)>` | 450 s (half the 15 min link) | presigned attachment URL                      | `AttachmentStorageAdapter.presign` | `MessagesService` after a message delete                                                              |

`ProfileSummaryCache` (`common/cache/profile-summary-cache.ts`) is the typed wrapper for the first two keys. It whitelists public fields before writing and stores dates as ISO strings; the reader treats a corrupt entry as a miss. Viewer-specific data such as `isFollowedByMe` is never cached. A cached signed URL is reused only while at least half of its validity remains, so a client never gets a link about to expire.

`CacheModule` is global and exports `CACHE_STORE`, `ProfileSummaryCache` and `CACHE_REDIS_CLIENT`. Hits, misses and errors are counted in `cache_requests_total{resource, result}`; the perf gate requires a profile hit ratio of at least 0.80.

To cache a new resource:

1. Add a key helper, a TTL constant and a `CacheResource` label in `cache-keys.ts` / `cache-store.port.ts`.
2. Read through `CACHE_STORE` (or a typed wrapper), writing on a miss.
3. Delete the key after every commit that changes the source data, never inside the transaction (§3.5).
4. Fake it in specs: `{ provide: CACHE_STORE, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() } }`.

### 3.15 Query Instrumentation and Repository Query Shape

Every HTTP request runs inside a query counter:

```
QueryContextMiddleware (all routes)      → AsyncLocalStorage { queries: 0 }
TypeOrmPerfLogger.logQuery()             → queries += 1   (prints nothing)
QueryCountInterceptor (APP_INTERCEPTOR)  → observes db_queries_per_request{route}
                                           + X-Db-Query-Count header when PERF_INSTRUMENTATION=true
```

- The files are `apps/core_microservice/src/common/db/query-context.ts`, `common/db/typeorm-perf.logger.ts` and `common/perf/query-count.interceptor.ts`.
- Only HTTP requests are counted. Socket handlers, AMQP consumers, the sweeper and outbox drains started by the poll run outside a context, and the increment is a no-op there. A drain woken by a request's `outbox.add` (the post-commit `setTimeout` in `TypeOrmOutboxAdapter`) inherits that request's `AsyncLocalStorage` context and can add its queries to that request's count.
- The header is a test aid for the e2e and perf suites. `assertSafeForEnvironment()` refuses `PERF_INSTRUMENTATION=true` with `NODE_ENV=production`.
- **Slow-query log.** The root TypeORM config sets `logging: ['query', 'error']`, `logger: new TypeOrmPerfLogger()` and `maxQueryExecutionTime: SLOW_QUERY_MS` (default 200). A slow query is logged at warn level with `durationMs`, a `queryId` (a hash of the normalized SQL, for grouping) and the SQL text cut to 2048 characters. **Query parameters are never logged**; the logger methods don't even take them.

Rules for list queries, so that their query count stays constant and they use an index:

- **Batch per page.** Load the page, then fetch related data for all its ids at once (`getLikeStats`, `getCommentCounts`, `findFollowedAmong`, `UserDirectoryAdapter.getUsers`). Never query once per row.
- **Ids first, then hydrate**, when the filter needs SQL the ORM can't express. `findFeedPage` selects ids with a LATERAL fan-out over followed authors, then loads the entities with relations by `In(ids)` and restores the order.
- **`limit + 1` instead of `COUNT`** for `hasMore`.
- **Stable order with a matching index**: `createdAt DESC, id DESC` plus an index in that order (`AddPerformanceIndexes1792450000000`).
- **Keep status literals inline** in SQL that should use a partial index (`p.status = '${PostStatus.Published}'`). A bound parameter hides the value from the planner.
- **Indexes TypeORM can't express live only in migrations**: partial, expression or `DESC` indexes such as `IDX_posts_feed`, `IDX_comments_post_roots`, `IDX_comments_parent`, `IDX_follows_*_created`, `IDX_user_profiles_username_lower` and `IDX_assets_pending_expiry`. `migration:generate` doesn't know about them and currently proposes `DROP INDEX` for six of them. Delete those lines from any generated migration (§10 Step 11).

---

## 4. Express & Manual DI Architecture — `auth_microservice`

### 4.1 Folder Structure

```
apps/auth_microservice/src/
├── main.ts                       # composition root: env, DB, Redis clients, both listeners, graceful shutdown
├── app.ts                        # createApp() (public) and createInternalApp() (internal-only)
├── config/                       # env.ts (fail-fast), database.ts, redis.ts, google.ts, swagger.ts
├── domain/
│   ├── entities/auth-user.entity.ts
│   └── interfaces/               # ports (4.5) + SessionContext
├── infrastructure/
│   ├── cache/redis.service.ts                         # RedisService implements ICacheService
│   ├── crypto/crypto.service.ts                       # BcryptService implements ICryptoService
│   ├── events/http-event-publisher.ts                 # HttpEventPublisher implements IEventPublisher
│   ├── events/redis-session-revocation.publisher.ts   # implements ISessionRevocationPublisher
│   ├── health/{database,redis}.check.ts               # createDatabaseCheck, createRedisCheck (HealthCheck objects, §8)
│   ├── jwt/jwt.service.ts                             # JwtService implements IJwtService
│   ├── oauth/google-oauth.service.ts                  # GoogleOAuthService implements IOAuthService
│   └── repositories/auth-user.repository.ts           # AuthUserRepository implements IAuthUserRepository
├── middleware/                   # auth (requireAuth), validate (validateBody), error-handler, internal-token
├── routes/                       # auth.routes.ts, users.routes.ts, internal.routes.ts (router factories)
├── services/                     # AuthService, UsersService
├── migrations/                   # incl. TimestampsWithTimeZone; auth_sessions exists only here (sessions live in Redis)
└── types/express.d.ts            # req.user augmentation
apps/auth_microservice/seed/      # seed.ts, perf-profile.ts (npm run db:seed -w auth_microservice)
```

Same layering as core, without decorators: services depend on port interfaces from `domain/interfaces/`, adapters in `infrastructure/` implement them, and the composition root wires them with `new`. Specs sit next to the code in every layer (`app.spec.ts`, `app.observability.spec.ts`, `config/env.spec.ts`, each middleware, route and adapter).

### 4.2 Composition Root

`main.ts` imports `./config/env` first, so a missing variable fails the process before anything connects:

```typescript
// apps/auth_microservice/src/main.ts (excerpt)
const dataSource = await initDatabase();
const redisClient = createRedisClient();
const redisService = new RedisService(redisClient, logger);
const sessionRedisClient = createRedisClient(); // dedicated connection for revocation publishing
const app = createApp(dataSource, logger, redisService, sessionRedisClient);
const internalApp = createInternalApp(dataSource, logger);
const server = app.listen(env.app.port);
const internalServer = internalApp.listen(internalPort, internalHost);
// SIGINT/SIGTERM: close both servers, quit both Redis clients, destroy the DataSource
```

`createApp()` is where the dependency graph is built:

```typescript
// apps/auth_microservice/src/app.ts (excerpt)
// createApp(dataSource, logger, redisService, sessionRedisClient, observability = {})
// `observability` ({ healthChecks?, metricsRegistry? }) is a test seam
const registry = observability.metricsRegistry ?? createMetricsRegistry("auth");
registerDbPoolGauge(registry, () => getPgPool(dataSource));
const healthChecks = observability.healthChecks ?? [
  createDatabaseCheck(dataSource),
  createRedisCheck(sessionRedisClient),
];
app.use(requestIdMiddleware()); // very first: request context for every log line
app.use(httpMetricsMiddleware(registry)); // so every route is timed
app.use(accessLogMiddleware(logger));
// express.json → cookieParser → helmet → cors → setupSwagger
const cryptoService = new BcryptService(env.crypto.saltRounds);
const authUserRepository = new AuthUserRepository(dataSource);
const usersService = new UsersService(
  authUserRepository,
  logger,
  cryptoService,
  new HttpEventPublisher(logger, env.app.internalApiToken),
);
const authService = new AuthService(
  usersService,
  redisService,
  logger,
  cryptoService,
  new JwtService(),
  new GoogleOAuthService(),
  new RedisSessionRevocationPublisher(sessionRedisClient, logger),
);
app.use(createObservabilityRouter(registry, healthChecks)); // /health, /health/details, /metrics (§8)
app.use("/users", createUsersRouter(usersService));
app.use("/auth", createAuthRouter(authService));
app.use(createErrorHandler(logger, errorsCounter)); // last
```

The middleware order is `requestIdMiddleware` → `httpMetricsMiddleware` → `accessLogMiddleware` → `express.json()` → `cookieParser()` (the refresh cookie depends on it) → `helmet()` → CORS from `env.app.allowedOrigins` (`AUTH_ALLOWED_ORIGINS`, `credentials: true`) → Swagger (`setupSwagger`, only when `SWAGGER_ENABLED` allows it) → observability router → routers.

Configuration lives only in `apps/auth_microservice/src/config/env.ts`: `requireEnv(key, default?)` throws on a missing variable (the message names the variable, not its value), `requireJwtSecret` makes `JWT_SECRET` / `JWT_REFRESH_SECRET` strict in production (32+ chars, not the `.env.example` or `CHANGE_ME` placeholders), an invalid `SWAGGER_ENABLED` throws, and the rest of the code reads the exported `env` object, never `process.env`. Add new variables there and to `.env.example`. `INTERNAL_API_TOKEN` is required and length-checked (32+) there, by auth's own code rather than the shared `assertInternalApiToken` that notifications uses. Specs that import anything loading `env` set the required variables (`CORE_SERVICE_URL`, `AUTH_ALLOWED_ORIGINS`, `INTERNAL_API_TOKEN`, ...) before the import. `config/env.spec.ts` tests the fail-fast cases with `jest.isolateModules` and a mocked `dotenv`.

### 4.3 Routes, Validation and Errors

Routers are factories that receive their service:

```typescript
// apps/auth_microservice/src/routes/auth.routes.ts (excerpt)
export function createAuthRouter(authService: AuthService): Router {
  const router = Router();
  router.post("/login", validateBody(LoginDto), async (req, res, next) => {
    try {
      const { email, password } = req.body as LoginDto;
      const result = await authService.login(
        email,
        password,
        sessionContext(req),
      ); // { ipAddress, userAgent }
      sendSession(res, result); // refresh token → httpOnly cookie, body = { accessToken, user }
    } catch (error) {
      next(error); // → error handler
    }
  });
  router.get("/me", requireAuth(authService), (req, res) => {
    /* req.user */
  });
  return router;
}
```

The refresh token never appears in a response body. `sendSession` sets it as the httpOnly `refresh_token` cookie (`REFRESH_COOKIE`), scoped to `path: '/auth'` with `secure`/`sameSite` from `env.cookie` (`AUTH_COOKIE_SAMESITE`, default `strict`). `/auth/refresh` and `/auth/logout` read it from `req.cookies` and take no body, and logout clears it. The client therefore calls auth with `credentials: 'include'`.

Routes on the public listener: `POST /users/register`, `POST /auth/login`, `POST /auth/google`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/logout`, `GET /health`, and `GET /health/details` and `GET /metrics` (both `X-Internal-Token`, §8). On the internal listener: `GET /internal/users/:id/contact`.

- `validateBody(DtoClass)` (`apps/auth_microservice/src/middleware/validate.middleware.ts`) runs `plainToInstance` + `validate` and answers 400 `{ statusCode, error: 'Bad Request', message: string[] }`; on success `req.body` is the DTO instance. DTOs come from `@repo/shared` (`LoginDto`, `CreateUserDto`, `GoogleLoginDto`).
- `requireAuth(authService)` (`apps/auth_microservice/src/middleware/auth.middleware.ts`) reads the Bearer token, calls `authService.verifyToken` (signature + access blacklist) and sets `req.user`; failures are `UnauthorizedError` → 401.
- `createErrorHandler(logger, errorsCounter?)` (the error middleware) maps errors with the table in §3.2 Layer 3, logs 5xx and counts them in `errors_total`. Malformed JSON bodies are a 400, neither logged nor counted.

### 4.4 Services

`UsersService` registers users (bcrypt hash through `ICryptoService`, persistence through `IAuthUserRepository`) and then calls `IEventPublisher.publishUserCreatedEvent` without awaiting (§7). `AuthService` handles login, Google login, refresh, logout and token verification, and depends only on ports plus `UsersService`:

```typescript
// apps/auth_microservice/src/services/auth.service.ts
constructor(
  private readonly usersService: UsersService,
  private readonly cacheService: ICacheService,
  private readonly logger: WinstonLogger,
  private readonly cryptoService: ICryptoService,
  private readonly jwtService: IJwtService,
  private readonly oauthService: IOAuthService,
  private readonly sessionRevocationPublisher: ISessionRevocationPublisher,
) {}
```

### 4.5 Ports and Adapters

| Port (`domain/interfaces/`)                                           | File                                | Adapter                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `IAuthUserRepository` (extends `RepositoryPort`)                      | `auth-user-repository.interface.ts` | `AuthUserRepository` (`TypeormRepositoryBase`, `super(dataSource.getRepository(AuthUser))`) |
| `ICacheService` (`get`, `setWithExpiry`, `delete`, `has`, `getOrSet`) | `cache.service.ts`                  | `RedisService` (ioredis)                                                                    |
| `ICryptoService`                                                      | `crypto.service.interface.ts`       | `BcryptService`                                                                             |
| `IJwtService` (+ `JwtPayload`, `RefreshTokenPayload`)                 | `jwt.service.interface.ts`          | `JwtService` (jsonwebtoken)                                                                 |
| `IOAuthService`                                                       | `oauth.service.interface.ts`        | `GoogleOAuthService` (google-auth-library)                                                  |
| `IEventPublisher`                                                     | `event-publisher.interface.ts`      | `HttpEventPublisher`                                                                        |
| `ISessionRevocationPublisher`                                         | `session-revocation-publisher.ts`   | `RedisSessionRevocationPublisher`                                                           |
| `SessionContext { ipAddress?, userAgent? }` (value type, not a port)  | `session-context.ts`                | built by the routes from the request                                                        |

Health checks are not ports: `createDatabaseCheck` and `createRedisCheck` return plain `HealthCheck` objects from `@repo/shared` (§8.2).

Service specs replace adapters with fakes that implement the port (`FakeCache implements ICacheService` in `apps/auth_microservice/src/services/auth.service.spec.ts`).

Gotcha: `http-event-publisher.ts` imports its port as `'src/domain/interfaces/event-publisher.interface'` (non-relative). Prefer relative imports in new files, and keep that path resolution in mind when moving files.

### 4.6 Sessions, Tokens and Revocation

Key layout is shared with core through `RedisKeys` (`packages/shared/src/redis/redis-keys.ts`):

| Key                              | Written by              | Meaning                                                                                         |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `refresh_tokens:{jti}`           | auth                    | refresh session JSON `{ userId, sid, ipAddress, userAgent, expiresAt }`, TTL = refresh lifetime |
| `blacklist:refresh:{jti}`        | auth                    | rotated or revoked refresh token                                                                |
| `blacklist:access:{jti}`         | auth (read by core)     | revoked access token, TTL = time left                                                           |
| `auth:session-revoked` (channel) | auth (consumed by core) | `SessionRevokedEvent` JSON                                                                      |

- Login and Google login create a session id `sid` (`randomUUID()`); access and refresh tokens both carry it, along with a `jti`.
- `POST /auth/refresh` reads the refresh token from the `refresh_token` cookie, checks the refresh blacklist and the `refresh_tokens:{jti}` record, blacklists the old refresh token (rotation) and issues a new pair with the **same** `sid` (new cookie, new access token in the body).
- `POST /auth/logout` clears the cookie first. It then deletes the session, blacklists the refresh token (from the cookie) and the access token (from an optional `Authorization: Bearer` header, so logout still works after the access token expired), and only then publishes `SessionRevokedEvent` (`sid` from the refresh token, else the access token). A publish failure is logged and does not fail logout. Core's reaction is in §3.10.

### 4.7 The Internal Listener

`createInternalApp(dataSource, logger, errorsCounter?)` serves `/internal` on its own listener, `AUTH_INTERNAL_HOST`:`AUTH_INTERNAL_PORT` (default `127.0.0.1:3012`); the public app never mounts `/internal`. It has no CORS, no Swagger and no `/health`.

```typescript
// apps/auth_microservice/src/app.ts
app.use(
  "/internal",
  createInternalTokenMiddleware(logger), // shared isValidInternalToken (SHA-256 + timingSafeEqual) → 401
  createInternalRouter(new AuthUserRepository(dataSource)),
);
```

`GET /internal/users/:id/contact` returns `{ userId, email }`, or 404 (a non-UUID id short-circuits without a query). The notifications service calls it through `AUTH_INTERNAL_URL` to address emails. `INTERNAL_API_TOKEN` is required (32+ characters) and must match on both sides. In containers set `AUTH_INTERNAL_HOST=0.0.0.0` and never publish port 3012.

**Exception to "internal routes live on the internal listener":** `/health/details` and `/metrics` are on the **public** port 3002, so that Prometheus scrapes all three services the same way. They are guarded by the shared `requireInternalToken` instead. The two token middlewares behave differently on failure:

| Middleware                              | Used on                                         | On failure                                                                                                           |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createInternalTokenMiddleware`         | `/internal` (internal listener)                 | logs a warning, `UnauthorizedError` → error handler → 401 `{ statusCode, error, message: 'Invalid internal token' }` |
| `requireInternalToken` (`@repo/shared`) | `/health/details`, `/metrics` (public listener) | no log, fixed 401 `{ statusCode: 401, message: 'Unauthorized' }`                                                     |

### 4.8 NestJS vs. Express Mapping

| Concern            | NestJS (core, notifications)                                                                                                                 | Express (auth)                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Entry point        | `main.ts` → `NestFactory.create(AppModule)`                                                                                                  | `main.ts` → `createApp(...)` + `createInternalApp(...)`                                               |
| Wiring             | `@Module({ imports, controllers, providers })`                                                                                               | `new` in `createApp()`                                                                                |
| Port binding       | `{ provide: TOKEN, useClass/useExisting }` + `@Inject(TOKEN)`                                                                                | constructor argument typed as the interface                                                           |
| Controllers        | `@Controller` + route decorators                                                                                                             | router factories                                                                                      |
| Validation         | global `ValidationPipe` (`whitelist`, `transform`)                                                                                           | per-route `validateBody(Dto)`                                                                         |
| Auth               | `@UseGuards(JwtAuthGuard)` + `@CurrentUser()`                                                                                                | `requireAuth(authService)` + `req.user`                                                               |
| Error mapping      | `DomainExceptionFilter`                                                                                                                      | `createErrorHandler` (table in §3.2 Layer 3)                                                          |
| Config             | `AppConfigService` over `@nestjs/config`                                                                                                     | `env` from `config/env.ts`                                                                            |
| Shutdown           | `enableShutdownHooks()` + lifecycle hooks                                                                                                    | `SIGINT`/`SIGTERM` handlers in `main.ts`                                                              |
| Swagger            | `@nestjs/swagger` decorators                                                                                                                 | typed OpenAPI object in `config/openapi.ts` (no `swagger-jsdoc`: auth compiles with `removeComments`) |
| Health and metrics | `ObservabilityModule` controllers, global `MetricsModule` (`METRICS_REGISTRY`), `httpMetricsMiddleware` + `registerDbPoolGauge` in `main.ts` | `createObservabilityRouter()` in `app.ts`, check factories in `infrastructure/health/`                |
| Internal token     | `@UseGuards(InternalTokenGuard)` (one copy per service)                                                                                      | `requireInternalToken` (shared) or `createInternalTokenMiddleware` (`/internal`)                      |
| HTTP tests         | `Test.createTestingModule`; core e2e via `createE2eApp()` (§9)                                                                               | supertest against `createApp(fakeDataSource, logger, fakeRedis, fakeRedis, { healthChecks })`         |

---

## 5. `notifications_consumer_microservice`

A NestJS service with its own database (`innogram_notifications`) and port (`NOTIFICATIONS_PORT`, 3003). It owns notifications and email preferences, consumes core's events and sends email over SMTP (Mailpit locally).

```
apps/notifications_consumer_microservice/src/
├── config/              # global AppConfigModule / AppConfigService (port, postgres, rabbitmq, redis, jwtSecret, internalApiToken, authInternalUrl, clientUrl, smtp)
├── common/
│   ├── auth/            # JwtAuthGuard, CurrentUser, access-token verifier (same AccessTokenVerifier)
│   ├── messaging/       # MessagingModule (EVENT_BUS, CONSUMER_REGISTRY, AMQP_CONNECTION), amqp-topology.ts, retry policy, consumer host
│   ├── observability/   # HealthController (inline checks), MetricsController, InternalTokenGuard, global MetricsModule (§8)
│   └── redis/
├── migrations/          # incl. TimestampsWithTimeZone, NotificationsKeysetIndex
└── modules/
    ├── notifications/   # domain/ (entities, ports, errors), application/ (handlers, email worker, purge scheduler), dto/ (incl. the cursor codec), infrastructure/ (repositories, mail, auth directory)
    └── preferences/     # domain/, dto/, infrastructure/, controller + service
```

Modules split into `domain/` (entities, ports with `Symbol` tokens, errors), `application/` (message handlers and workers) and `infrastructure/` (TypeORM repositories, `NodemailerAdapter` behind `MAILER`, `AuthDirectoryAdapter` behind `RECIPIENT_DIRECTORY`). `MessagingModule` also exports `AMQP_CONNECTION` and `NotificationsModule` exports `MAILER`, both only so the health checks can reach them. The REST surface is `GET /notifications`, `GET /notifications/unseen-count`, `POST /notifications/seen`, `GET|PUT /notifications/preferences`, all scoped to `user.sub`, with Swagger at `/api`. On top of that come `GET /health`, `GET /health/details` and `GET /metrics` (§8), hidden from Swagger with `@ApiExcludeController`. `main.ts` registers the same request-id/access-log middleware, `ValidationPipe` and `DomainExceptionFilter` as core, CORS from `AppConfigService.clientUrl`, `httpMetricsMiddleware`, `registerDbPoolGauge` and Swagger (`SWAGGER_ENABLED`). `config/env.validation.ts` fails fast on missing required variables, as in core. `AppConfigService.onModuleInit` runs the shared `assertInternalApiToken`, so a missing or short `INTERNAL_API_TOKEN` stops startup instead of failing on the first email.

**Keyset pagination of `GET /notifications`.** `before` is the previous page's opaque `nextCursor`: base64url JSON of `[isoOccurredAt, id]` (`modules/notifications/dto/notification-cursor.ts`). A bare ISO `occurredAt` is still accepted for older clients, but it has no tie-breaker. `limit` is 1–50 (`PAGE_SIZE_MAX`), default 20. A malformed cursor is a 400 (DTO validator, plus `InvalidNotificationCursorError` as a plain `DomainError`). The response is `{ items, hasMore, unseenCount, nextCursor }`, with `nextCursor` null on the last page.

```typescript
// apps/notifications_consumer_microservice/src/modules/notifications/infrastructure/repository/notification.repository.ts
if (before?.id) {
  query.andWhere('(n."occurredAt", n.id) < (:beforeAt, :beforeId)', {
    beforeAt: before.occurredAt,
    beforeId: before.id,
  });
} else if (before) {
  query.andWhere('n."occurredAt" < :beforeAt', { beforeAt: before.occurredAt }); // legacy cursor
}
query
  .orderBy("n.occurredAt", "DESC")
  .addOrderBy("n.id", "DESC")
  .limit(options.limit + 1);
```

The index `IDX_notifications_recipientId_occurredAt_id` (`recipientId, occurredAt DESC, id DESC`, migration `1792600000000-NotificationsKeysetIndex.ts`) matches that order.

**Queues** (`apps/notifications_consumer_microservice/src/common/messaging/amqp-topology.ts`):

| Queue                  | Bindings                           | Retry                       | Dead letter    |
| ---------------------- | ---------------------------------- | --------------------------- | -------------- |
| `notifications.events` | `social.#`, `chat.message.alerted` | `.retry` (10 s), 5 attempts | `.dlq`         |
| `notifications.email`  | email jobs                         | `.retry` (30 s), 3 attempts | none (dropped) |

A failed message is re-published to its retry queue with an incremented `x-attempts` and then acked. Invalid payloads, unknown types and `PoisonMessageError` skip retries.

**Handlers.** `SocialEventHandler` stores a notification (idempotent on the envelope's `eventId` through processed-event records and unique keys), publishes `notification.created` after commit and enqueues an email job when the recipient's preferences allow it. `MessageAlertHandler` stores no notification and only enqueues an email linking to `/messages/{chatId}`. `EmailWorker` sends through `MAILER`, with `email_deliveries` as the source of truth for attempts; recipient addresses come from auth's internal endpoint, cached in `recipient_contacts`. `POST /notifications/seen` publishes `notification.seen`. Both `notification.*` events reach browsers through core's relay (§3.11).

---

## 6. Request Lifecycle — `core_microservice`

Tracing `PATCH /chats/:chatId/messages/:messageId` (edit own message):

1. **HTTP entry.** Helmet, `httpMetricsMiddleware` (times the request, labelled by route template), cookie-parser and CORS run. `QueryContextMiddleware` opens the per-request query counter (§3.15), then Nest routes to `MessagesController.edit`.
2. **Guard.** The class-level `@UseGuards(JwtAuthGuard)` verifies the Bearer token through `AccessTokenVerifier`: missing/invalid/revoked → 401, Redis down → 503. On success `request.user = { sub, email, jti, sid?, exp }`. The global `QueryCountInterceptor` wraps the handler from here on.
3. **Pipes.** `ParseUUIDPipe` rejects malformed ids (400). The global `ValidationPipe` turns the body into `EditMessageDto`, strips undecorated fields and rejects invalid ones (400).
4. **`@CurrentUser('sub')`** hands the caller's auth user id to the controller, which calls `messagesService.edit(userId, chatId, messageId, dto)`.
5. **Service.** Opens `runInTransaction`; inside it locks the chat (`findByIdForUpdate`), checks membership through `chat.assertCanPost(me)` (non-member → `ChatNotFoundError` → 404), loads the message visible to the caller (`MessageNotFoundError` → 404; a message from before the caller joined → `ChatNotFoundError`), and allocates a `changeSeq`.
6. **Entity.** `message.edit(me, content, changeSeq)` enforces the rules: system messages are immutable (400), only the author may edit (`NotMessageAuthorError` → 403), deleted messages can't be edited (400), length and emptiness limits (400).
7. **Repository.** `messages.update(found, tx)` issues a narrow `UPDATE`; the transaction commits.
8. **Response and emit.** The service maps the entity with the chats mapper. Attachment URLs come from the signed-URL cache or are presigned fresh (§3.14); one that fails to presign is returned without a URL. It emits `message:updated` to `chat:{chatId}` through `CHAT_REALTIME_PORT` (post-commit, failures logged) and returns the DTO. The controller sends 200, and the interceptor records `db_queries_per_request` for the route.
9. **On error.** A `DomainError` anywhere in steps 5–7 rolls the transaction back and `DomainExceptionFilter` answers with the table in §3.2 Layer 3; nothing is emitted.

```
Client ─▶ helmet/metrics/CORS ─▶ query context ─▶ JwtAuthGuard ─▶ ParseUUIDPipe/ValidationPipe ─▶ Controller
      ─▶ Service (tx: lock, load, allocate) ─▶ Entity rule ─▶ Repository (UPDATE) ─▶ commit
      ─▶ response DTO (cached presign) ─▶ emit message:updated ─▶ 200
   (DomainError ─▶ rollback ─▶ DomainExceptionFilter ─▶ 4xx/5xx JSON)
```

---

## 7. Auth → Core: User Creation

Registration in auth is followed by a fire-and-forget HTTP call to core; there is no broker on this path.

**Auth side.** `UsersService` builds a `UserCreatedEvent(authUserId, email, handle, timestamp)` (handle = email local part) and calls `IEventPublisher.publishUserCreatedEvent`. The adapter does not await:

```typescript
// apps/auth_microservice/src/infrastructure/events/http-event-publisher.ts (excerpt)
const url = `${coreUrl}/internal/events/user-created`; // coreUrl = CORE_SERVICE_URL
fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    [INTERNAL_TOKEN_HEADER]: this.internalApiToken,
  },
  body: JSON.stringify(payload),
})
  .then((res) => {
    if (!res.ok)
      this.logger.warn(
        `Failed to publish event to Core. Status: ${res.status}`,
      );
  })
  .catch((err) =>
    this.logger.error(
      `Network error while publishing event to Core: ${err.message}`,
    ),
  );
```

**Core side.** `InternalEventsModule` imports `ProfilesModule`; its controller is a routing layer with no business logic:

```typescript
// apps/core_microservice/src/modules/internal-events/internal-events.controller.ts
@ApiExcludeController()
@Controller("internal/events")
export class InternalEventsController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post("user-created")
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalTokenGuard)
  async handleUserCreated(@Body() event: UserCreatedEvent): Promise<void> {
    await this.profilesService.createProfile(event.authUserId, event.handle);
  }
}
```

`UserCreatedEvent` (`packages/shared/src/events/user-created.event.ts`) carries `class-validator` decorators; without them the global `ValidationPipe` would strip every field. `createProfile` is idempotent (an existing profile for the `authUserId` is returned) and retries a username collision with a random suffix. It is also safe against the race between the event and a lazy create: on a `UniqueConstraintViolationError` it re-reads by `authUserId` and returns the row the other request created, instead of answering 409. After an insert it invalidates the cached profile (§3.14). The route is excluded from Swagger and must stay internal (Docker network only, never exposed publicly). It is guarded by `InternalTokenGuard` (§8.4): `HttpEventPublisher` sends `X-Internal-Token` with `INTERNAL_API_TOKEN`, so a wrong or missing token gets 401 and no profile.

**Lazy-init fallback.** Failures are logged, never retried, so a profile can be missing. `GET /profiles/me` calls `ProfilesService.getOrCreateProfileByAuthUserId(sub, email)` (`apps/core_microservice/src/modules/profiles/profiles.service.ts`), which creates the profile on first read when it doesn't exist. The client loads its own profile through that route (`getMyProfile` in `apps/client_app/src/lib/api/profile.ts`). `AppShell` (`apps/client_app/src/components/shell/app-shell.tsx`) calls it on every signed-in route, so the gap closes on the first page load.

---

## 8. Observability Across Services

All three backends expose the same three endpoints, built from one shared implementation in `packages/shared/src/observability/`.

### 8.1 Endpoints

| Route                 | Access             | Returns                                                                                                     |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GET /health`         | public             | `{ status }` (`IHealthStatus`): 200 for `healthy`/`degraded`, 503 for `unhealthy`. Never names dependencies |
| `GET /health/details` | `X-Internal-Token` | `IHealthReport { status, service, checkedAt, checks: { <name>: { status, critical, latencyMs, error? } } }` |
| `GET /metrics`        | `X-Internal-Token` | Prometheus text format                                                                                      |

They are served on each service's **main port** (3001, 3002, 3003), not on auth's internal listener (§4.7). None of them uses `JwtAuthGuard`. `httpMetricsMiddleware` skips them, so probes don't skew request metrics.

### 8.2 Health checks

```typescript
// packages/shared/src/observability/health-runner.ts
export interface HealthCheck {
  name: string;
  critical: boolean;
  run(): Promise<void>; // resolve = up, throw = down
}
```

`runHealthChecks(service, checks)` runs every check in parallel, each raced against a 1 s timeout. The rollup is: any critical check down → `unhealthy`, any other check down → `degraded`, otherwise `healthy`. A failed check reports only the error's class name, because driver messages can contain hosts or credentials.

| Service       | Critical                                                     | Non-critical                                                                   |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| core          | `database` (`SELECT 1`), `session_redis`                     | `cache_redis`, `broker`, `object_storage` (`HeadBucket` on the private bucket) |
| notifications | `database`, `session_redis`, `broker` (consuming is its job) | `smtp`                                                                         |
| auth          | `database`, `redis`                                          | —                                                                              |

Adding a check works differently per service:

- **core:** an `@Injectable() class XCheck implements HealthCheck` in `apps/core_microservice/src/common/observability/checks/`. Add it to `providers` **and** to the `inject` list of the `HEALTH_CHECKS` factory in `observability.module.ts`:

  ```typescript
  @Injectable()
  export class CacheRedisCheck implements HealthCheck {
    readonly name = "cache_redis";
    readonly critical = false;
    constructor(@Inject(CACHE_REDIS_CLIENT) private readonly redis: Redis) {}
    async run(): Promise<void> {
      if (this.redis.status !== "ready") throw new Error("not ready");
      await this.redis.ping();
    }
  }
  ```

- **notifications:** push an object into the check list built in the `HealthController` constructor (`apps/notifications_consumer_microservice/src/common/observability/health.controller.ts`), injecting the dependency there. That is why `AMQP_CONNECTION` and `MAILER` are exported. The SMTP check calls `verify()`, which exists on `NodemailerAdapter` but not on the `IMailer` port.
- **auth:** a factory returning a `HealthCheck` in `apps/auth_microservice/src/infrastructure/health/`, appended to the default array in `createApp()`.

A check should be cheap (a ping, `SELECT 1`, a HEAD request). When the client has no offline queue it should fail fast instead of waiting (see `CacheRedisCheck`).

### 8.3 Metrics

`createMetricsRegistry(service)` builds one `prom-client` `Registry` per service, with a default `service` label and the Node default metrics. Core and notifications provide it as `METRICS_REGISTRY` from a global `MetricsModule`; auth creates it in `createApp()`. A metric is defined by the class that records it, with get-or-create, so a second instance of the provider (tests, re-created modules) doesn't throw on a duplicate name:

```typescript
// apps/core_microservice/src/common/perf/query-count.interceptor.ts
const existing = registry.getSingleMetric(METRIC_NAME);
this.queries =
  (existing as Histogram<"route"> | undefined) ??
  new Histogram({
    name: METRIC_NAME,
    help: "…",
    labelNames: ["route"],
    buckets: BUCKETS,
    registers: [registry],
  });
```

| Series                                                                                                                  | Labels                                                          | Recorded by                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `http_request_duration_seconds`                                                                                         | `method`, `route`, `status_class`                               | `httpMetricsMiddleware` (all services)                                                                                                                                                                                               |
| `http_request_errors_total`                                                                                             | `method`, `route`, `status_class` (4xx and 5xx)                 | `httpMetricsMiddleware`                                                                                                                                                                                                              |
| `db_pool_connections`                                                                                                   | `state` (`total`, `idle`, `waiting`)                            | `registerDbPoolGauge` (register **once** per registry; not idempotent)                                                                                                                                                               |
| `db_queries_per_request`                                                                                                | `route`                                                         | `QueryCountInterceptor` (core, §3.15)                                                                                                                                                                                                |
| `cache_requests_total`                                                                                                  | `resource`, `result` (`hit`, `miss`, `error`)                   | `RedisCacheAdapter` (core, §3.14)                                                                                                                                                                                                    |
| `uploads_total`                                                                                                         | `purpose`, `outcome`                                            | `UploadsService` (core, §3.13)                                                                                                                                                                                                       |
| `errors_total`                                                                                                          | `source` (`http`, `amqp`, `process`), `type` (error class name) | `DomainExceptionFilter` / `createErrorHandler` (every handled error incl. 4xx domain errors), consumers (failed handler), process error hooks. `recordError(counter, source, err)`; `createErrorsCounter(registry)` is get-or-create |
| `amqp_messages_total`, `amqp_handler_duration_seconds`                                                                  | `queue`, `outcome` (`ack`, `retry`, `dlq`, `drop`); `queue`     | core relay and notifications consumers via `createAmqpMetrics` / `recordAmqpOutcome` / `observeAmqpHandler`                                                                                                                          |
| `outbox_published_total`, `outbox_failed_total`, `outbox_dead_total`, `outbox_pending`, `outbox_oldest_pending_seconds` | none                                                            | `OutboxRelay` (core, §3.11)                                                                                                                                                                                                          |
| Node defaults (`process_resident_memory_bytes`, ...)                                                                    | `service`                                                       | `createMetricsRegistry`                                                                                                                                                                                                              |

**Label cardinality.** Labels take values from a small fixed set. `route` is the matched route template (`/posts/:id`) or `unmatched`, never the raw URL, which would create a series per id and leak ids. Never use a user id, an email or an error message as a label.

### 8.4 The internal token

`X-Internal-Token` (`INTERNAL_TOKEN_HEADER`) carries `INTERNAL_API_TOKEN`. That is one value for all three services, at least 32 characters (`MIN_INTERNAL_API_TOKEN_LENGTH`), and each service refuses to start without it (core in `main.ts`, notifications in `AppConfigService.onModuleInit`, auth in `env.ts`). The shared helpers live in `packages/shared/src/observability/internal-token.ts`:

- `isValidInternalToken(given, expected)` hashes both values with SHA-256 and compares them with `timingSafeEqual`, so neither timing nor length leaks.
- `requireInternalToken(expected)` is the Express middleware (auth).
- `assertInternalApiToken(value)` is the startup check.

Nest services guard a route with `@UseGuards(InternalTokenGuard)`. The guard reads `AppConfigService.internalApiToken` and throws 401; core and notifications each have their own copy in `common/observability/internal-token.guard.ts`. The same token authorizes notifications' calls to `GET /internal/users/:id/contact` (§4.7). `POST /internal/events/user-created` is guarded the same way (§7).

### 8.5 Monitoring profile

`docker compose --profile monitoring up -d` starts Prometheus (no host port) and Grafana (`http://localhost:3030`, anonymous viewer, provisioned dashboard `docker/monitoring/grafana/`, admin password from `GRAFANA_ADMIN_PASSWORD`; the Grafana entrypoint refuses an empty one). Prometheus runs one job, `innogram`, scraping every 15 s the targets in `PROMETHEUS_TARGETS` (default `host.docker.internal:3001/3002/3003`; `docker-compose.apps.yml` sets `core:3001,auth:3002,notifications:3003`), each with a `service` label. `docker/monitoring/entrypoint.sh` writes the targets and `INTERNAL_API_TOKEN` to tmpfs files that `prometheus.yml` reads, so the token is never committed, and the container fails to start when the token is unset. With the Docker app stack, add the same `--profile monitoring` to the `docker:apps:up` compose command (`docs/DEPLOYMENT.md`).

Alerts are defined in `docker/monitoring/alerts.yml`: `ServiceDown`, `High5xxRate`, `HighP95Latency`, `OutboxBacklog`, `OutboxDead`, `AmqpDlqGrowth`, `DbPoolSaturated`. A new metric that deserves an alert gets a rule there. Metric and alert reference: `docs/OBSERVABILITY.md`.

### 8.6 Logging, request ids and error tracking

All three backends log JSON through `WinstonLogger` (`LOG_LEVEL`; invalid values fall back to the default). Error tracking is self-hosted: structured logs, `errors_total` (§8.3), the alerts above and, in the client, Next error boundaries (`error.tsx`, `global-error.tsx`). There is no Sentry or other SaaS.

- **Request id.** `requestIdMiddleware()` (first in every app) takes a valid incoming `x-request-id` (1–128 chars of `A-Za-z0-9._-`) or generates a UUID, echoes it on the response and stores it in `AsyncLocalStorage`. `currentRequestId()` reads it anywhere below, without passing it through calls.
- **Access log.** `accessLogMiddleware(logger)` writes one line per response on `finish`: method, route template, status, duration (`correlationId` in the log data). Never query strings, bodies or headers. It skips `/health` and `/metrics`.
- **Across the broker.** `EventBus.publish(event, { correlationId })` sets the AMQP header `x-correlation-id` (`CORRELATION_ID_HEADER`). Core's outbox keeps it in `outbox_events.correlation_id`, so notifications and the relay log the id of the request that caused the event.
- **Never log** secrets, tokens, cookies or request bodies, and keep metric labels bounded (§8.3).

---

## 9. Test Layers

Commands are in `AGENTS.md` / `CLAUDE.md`; this section is about where each kind of test lives and what it needs.

| Layer                             | Where                                                                     | What it uses                                                                                                                                                                                                                                | Needs                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity specs                      | next to the entity (`*.entity.spec.ts`)                                   | fakers from `modules/<m>/__tests__/fakers/`                                                                                                                                                                                                 | nothing (no Nest)                                                                                                                                                                                                   |
| Nest service and controller specs | next to the file (`*.service.spec.ts`)                                    | `Test.createTestingModule` with token fakes (`useValue`), a `LoggerKey` fake, `ProfileSummaryCache` / `METRICS_REGISTRY` fakes where injected (§3.3)                                                                                        | nothing                                                                                                                                                                                                             |
| Express specs (auth)              | next to the file                                                          | fakes implementing the port (`FakeCache implements ICacheService`); supertest against `createApp(fakeDataSource, logger, fakeRedis, fakeRedis, { healthChecks })`; env set before import, `jest.isolateModules` for fail-fast config        | nothing                                                                                                                                                                                                             |
| Core e2e                          | `apps/core_microservice/test/*.e2e-spec.ts`                               | `test/helpers`: `createE2eApp(env?)` → `{ app, http, db, close }` (request-facing `main.ts` wiring, §3.7), `registerAndLogin`, `createPublishedPosts`, `dbQueryCount` (with `PERF_INSTRUMENTATION=true`), `connectSocket`, `cleanupE2eData` | real Postgres, Redis, redis-cache, RabbitMQ, SeaweedFS, a running auth (and notifications for the relay suite); dependencies are not mocked (only `observability.e2e-spec.ts` overrides `HEALTH_CHECKS` with fakes) |
| Notifications e2e                 | `apps/notifications_consumer_microservice/test/`                          | repositories, idempotency, a broker round trip, the HTTP API; `observability.e2e-spec.ts` boots `AppModule` itself and repeats the `main.ts` wiring                                                                                         | Postgres, Redis, RabbitMQ                                                                                                                                                                                           |
| Browser E2E                       | `apps/client_app/e2e/` (Playwright, Chromium)                             | `fixtures/test.ts` fails a test on any `console.error`; `fixtures/run-id.ts` `uniqueUser()` makes fresh users per run (no seed needed); `fixtures/api.ts` sets data up through the API                                                      | the full stack and the client already running (no `webServer`)                                                                                                                                                      |
| Performance gate                  | `apps/core_microservice/test/load/` (k6 + `run-k6.sh`, `group-fanout.ts`) | per-endpoint p95 and error-rate thresholds in `k6/thresholds.js`, profile cache hit ratio ≥ 0.80 from `/metrics`; reports in `reports/`                                                                                                     | core and auth built (`node dist/main`), the `perf` seed                                                                                                                                                             |

- **Coverage gate.** `npm run test:cov -w <ws>` enforces 70% lines / 60% branches globally in core, auth, notifications and `@repo/shared`. CI (`.github/workflows/ci.yml`) runs `lint:check` → `build` → `type-check`, then the coverage as a 4-entry matrix. `docker-images.yml` only builds the images. CI doesn't run e2e, Playwright or perf. Core and notifications e2e load the root `.env` through `test/setup-env.ts`.
- **Seeds.** `seed/` in auth and core, plus the root `seed/fixtures.ts` and `seed/perf.ts`. The `perf` profile is deterministic and must be seeded in auth first, then core (`--profile perf --reset`). Seeds write tables directly, so no outbox events fire.
- **Runbooks:** `apps/core_microservice/test/README.md` (what each suite needs, the helper catalogue) and `apps/core_microservice/test/load/README.md` (perf gate, baseline and compare).

---

## 10. Developer Cookbook: Adding a Feature Module (Bookmarks)

Example: users bookmark posts. `POST /bookmarks` (create), `GET /bookmarks` (mine, paged), `DELETE /bookmarks/:id` (only the owner). Everything lives in `modules/bookmarks/`.

### Step 1: Folder structure

```
modules/bookmarks/
├── bookmarks.module.ts
├── bookmarks.controller.ts
├── bookmarks.service.ts
├── bookmarks.service.spec.ts
├── domain/
│   ├── entities/{bookmark.entity.ts, bookmark.entity.spec.ts}
│   ├── interfaces/{bookmark.props.ts, bookmark-repository.port.ts}
│   └── errors/bookmark.errors.ts
├── dto/{create-bookmark.dto.ts, list-bookmarks-query.dto.ts, list-bookmarks-query.dto.spec.ts, bookmark-response.dto.ts}
├── infrastructure/repository/bookmark.repository.ts
└── __tests__/fakers/{index.ts, bookmark.faker.ts}
```

### Step 2: Contracts

Add these under a new `bookmarks/` area in `packages/contracts/src/`:

- `ICreateBookmarkRequest { postId: string }`
- `IListBookmarksQuery { page?: number; limit?: number }`
- `IBookmarkResponse { id, postId, createdAt }`

The list response is `IOffsetPage<IBookmarkResponse>` from `common/pagination.ts`. Re-export everything from the area's `index.ts` and from `packages/contracts/src/index.ts`, then run `npm run build -w @repo/contracts`.

### Step 3: Props and entity

```typescript
// domain/interfaces/bookmark.props.ts
export interface BookmarkProps {
  userId: string; // auth user id (JWT sub)
  postId: string;
}
```

```typescript
// domain/entities/bookmark.entity.ts
@Entity("bookmarks")
@Unique("UQ_bookmarks_userId_postId", ["userId", "postId"])
@Index("IDX_bookmarks_userId_createdAt_id", ["userId", "createdAt", "id"]) // serves the paged list (Step 7)
export class Bookmark extends TypeormEntityBase implements BookmarkProps {
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne("UserProfile")
  @JoinColumn({
    name: "userId",
    referencedColumnName: "authUserId",
    foreignKeyConstraintName: "FK_bookmarks_userId_authUserId",
  })
  user!: UserProfile; // import type

  @Column({ type: "uuid" })
  postId!: string;

  @ManyToOne("Post", { onDelete: "CASCADE" })
  @JoinColumn({
    name: "postId",
    foreignKeyConstraintName: "FK_bookmarks_postId",
  })
  post!: Post; // import type

  static create(props: BookmarkProps): Bookmark {
    const bookmark = new Bookmark();
    bookmark.userId = props.userId;
    bookmark.postId = props.postId;
    return bookmark;
  }

  /** Ownership is a domain rule: only the owner may remove a bookmark. */
  assertOwnedBy(userId: string): void {
    if (this.userId !== userId) throw new NotBookmarkOwnerError();
  }
}
```

### Step 4: Domain errors

```typescript
// domain/errors/bookmark.errors.ts
import { AccessDeniedError, DomainError } from "@repo/shared";

export class NotBookmarkOwnerError extends AccessDeniedError {
  // → 403
  constructor() {
    super("You can only remove your own bookmarks.");
  }
}
export class PostNotBookmarkableError extends DomainError {
  // → 400
  constructor(postId: string) {
    super(`Post ${postId} cannot be bookmarked.`);
  }
}
```

A missing bookmark comes from the base `findOneByIdOrThrow` (`EntityByIdNotFoundError` → 404); a duplicate from the unique constraint (`UniqueConstraintViolationError` → 409). Statuses follow the table in §3.2 Layer 3; no `HttpException` anywhere below the controller.

### Step 5: Port and token

```typescript
// domain/interfaces/bookmark-repository.port.ts
import type { RepositoryPort } from "@repo/shared";
import type { Bookmark } from "../entities/bookmark.entity";
import type { BookmarkProps } from "./bookmark.props";

export interface IBookmarkRepository extends RepositoryPort<
  Bookmark,
  BookmarkProps
> {
  /** The user's bookmarks, newest first; returns up to `limit + 1` rows so the caller can set `hasMore`. */
  findPageByUser(
    userId: string,
    paging: { offset: number; limit: number },
  ): Promise<Bookmark[]>;
}

export const BOOKMARK_REPOSITORY = Symbol.for("IBookmarkRepository");
```

### Step 6: DTOs

```typescript
// dto/create-bookmark.dto.ts
export class CreateBookmarkDto implements ICreateBookmarkRequest {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  postId!: string;
}

// dto/list-bookmarks-query.dto.ts (out-of-range limit → 400, never clamped, §3.12)
export class ListBookmarksQueryDto implements IListBookmarksQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  limit: number = 20;
}

// dto/bookmark-response.dto.ts
export class BookmarkResponseDto implements IBookmarkResponse {
  @ApiProperty() id: string;
  @ApiProperty() postId: string;
  @ApiProperty() createdAt: string;

  constructor(bookmark: Bookmark) {
    this.id = bookmark.id;
    this.postId = bookmark.postId;
    this.createdAt = bookmark.createdAt.toISOString();
  }
}
```

### Step 7: Repository adapter

```typescript
// infrastructure/repository/bookmark.repository.ts
@Injectable()
export class BookmarkRepository
  extends TypeormRepositoryBase<Bookmark, BookmarkProps>
  implements IBookmarkRepository
{
  public static readonly entity = Bookmark;
  protected relations: string[] = [];

  constructor(@InjectRepository(Bookmark) repository: Repository<Bookmark>) {
    super(repository);
  }

  findPageByUser(
    userId: string,
    { offset, limit }: { offset: number; limit: number },
  ): Promise<Bookmark[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: "DESC", id: "DESC" }, // stable: ties on createdAt are broken by id
      skip: offset,
      take: limit + 1, // the extra row only answers "is there more?"
    });
  }
}
```

### Step 8: Service (ports by token, ownership before mutation)

```typescript
// bookmarks.service.ts
@Injectable()
export class BookmarksService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(BOOKMARK_REPOSITORY)
    private readonly bookmarks: IBookmarkRepository,
    @Inject(POST_REPOSITORY) private readonly posts: IPostRepository,
  ) {}

  async create(userId: string, dto: CreateBookmarkDto): Promise<Bookmark> {
    const post = await this.posts.findById(dto.postId);
    if (!post) throw new EntityByIdNotFoundError("Post", dto.postId);
    // A visibility rule would be a Post method (cf. Post.assertLikeableBy).
    const saved = await this.bookmarks.save(
      Bookmark.create({ userId, postId: post.id }),
    );
    this.logger.debug("Bookmark created", { props: { bookmarkId: saved.id } });
    return saved;
  }

  async listMine(
    userId: string,
    page: number,
    limit: number,
  ): Promise<IOffsetPage<Bookmark>> {
    const rows = await this.bookmarks.findPageByUser(userId, {
      offset: (page - 1) * limit,
      limit,
    });
    return {
      items: rows.slice(0, limit),
      page,
      limit,
      hasMore: rows.length > limit,
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    const bookmark = await this.bookmarks.findOneByIdOrThrow(id); // 404
    bookmark.assertOwnedBy(userId); // 403 for anyone else
    await this.bookmarks.delete(bookmark);
    this.logger.debug("Bookmark removed", { props: { bookmarkId: id } });
  }
}
```

If creating a bookmark should notify someone, write the outbox row in the same transaction: add `runInTransaction` and `save(e, tx?)` to the port (§3.5) and call `this.outbox.add(routingKey, payload, tx)` with `OUTBOX_PORT`. If bookmark counts ever get cached (§3.14), delete the key **after** the commit in `create` and `remove`.

### Step 9: Controller (guarded, `user.sub` only)

```typescript
// bookmarks.controller.ts
@ApiTags("Bookmarks")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("bookmarks")
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Post()
  @ApiOperation({ summary: "Bookmark a post" })
  async create(
    @CurrentUser("sub") userId: string,
    @Body() dto: CreateBookmarkDto,
  ): Promise<BookmarkResponseDto> {
    return new BookmarkResponseDto(
      await this.bookmarksService.create(userId, dto),
    );
  }

  @Get()
  @ApiOperation({ summary: "List my bookmarks" })
  async listMine(
    @CurrentUser("sub") userId: string,
    @Query() query: ListBookmarksQueryDto,
  ): Promise<IOffsetPage<BookmarkResponseDto>> {
    const page = await this.bookmarksService.listMine(
      userId,
      query.page,
      query.limit,
    );
    return {
      ...page,
      items: page.items.map((b) => new BookmarkResponseDto(b)),
    };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove one of my bookmarks" })
  remove(
    @CurrentUser("sub") userId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bookmarksService.remove(userId, id);
  }
}
```

The user id always comes from the verified token, never from the body or a route parameter.

### Step 10: Module and registration

```typescript
// bookmarks.module.ts
@Module({
  imports: [
    TypeOrmModule.forFeature([Bookmark]),
    LoggerModule.forFeature("BookmarksService"),
    PostsModule, // exports POST_REPOSITORY
  ],
  controllers: [BookmarksController],
  providers: [
    BookmarksService,
    { provide: BOOKMARK_REPOSITORY, useClass: BookmarkRepository },
  ],
})
export class BookmarksModule {}
```

Add `BookmarksModule` to the imports in `apps/core_microservice/src/app.module.ts` and, optionally, a tag to `SWAGGER_TAGS` in `apps/core_microservice/src/swagger.ts`. Document every route (`@ApiOperation`, response decorators, `@ApiBearerAuth` when guarded): `test/openapi.e2e-spec.ts` checks the generated document and fails on an undocumented route.

### Step 11: Migration

`synchronize` is off; every schema change is a migration in `apps/core_microservice/src/migrations/`. The CLI uses `apps/core_microservice/data-source.ts` at the app root, which loads the root `.env` and globs `src/**/*.entity{.ts,.js}` (so the file must be named `*.entity.ts`):

```bash
cd apps/core_microservice
npm run migration:generate -- src/migrations/AddBookmarks
npm run migration:run      # migration:revert to undo
```

Check that the generated SQL contains only your table, and that the constraint names match the entity (`UQ_bookmarks_userId_postId`, `IDX_bookmarks_userId_createdAt_id`, `FK_bookmarks_*`). **Today `migration:generate` also emits `DROP INDEX` for six indexes that exist only in migrations** (`IDX_posts_feed`, `IDX_comments_post_roots`, `IDX_comments_parent`, `IDX_follows_follower_created`, `IDX_follows_following_created`, `IDX_assets_pending_expiry`, §3.15). Delete those lines from `up()` and the matching `CREATE INDEX` lines from `down()`. A hand-written migration uses an epoch-ms prefix larger than the latest existing one and a full inverse `down()`. An index TypeORM can't express (partial, expression, mixed `DESC`) goes in a hand-written migration only.

### Step 12: Tests

- Entity spec without Nest: `expect(() => fakeBookmark({ userId: 'a' }).assertOwnedBy('b')).toThrow(NotBookmarkOwnerError)`.
- Service spec: `Test.createTestingModule` with `{ provide: BOOKMARK_REPOSITORY, useValue: fake }`, `{ provide: POST_REPOSITORY, useValue: fake }` and a `LoggerKey` fake. Assert that `remove` by another user throws and never calls `delete`, and that `listMine` sets `hasMore` from the extra row.
- DTO spec: `limit` of `0`, `-1`, `abc` and `PAGE_SIZE_MAX + 1` is rejected, not clamped (cf. `profiles/dto/search-profiles-query.dto.spec.ts`).
- E2E: add `GET /bookmarks` to the endpoint table in `test/pagination.e2e-spec.ts`. For behaviour against real Postgres, add `test/bookmarks.e2e-spec.ts` using `createE2eApp` and `registerAndLogin` (§9).
- Run `cd apps/core_microservice && npx jest bookmarks`, `npm run test:cov` (70/60 gate) and `npm run build -w core_microservice` (CI's type check).

### Key rules

1. Rules live on entities and throw `DomainError` subclasses; pick the base class by status (§3.2 Layer 3).
2. Ports are interfaces with `Symbol` tokens; modules bind them, services inject them by token, controllers inject services only.
3. Every mutating route is guarded, takes the user from `@CurrentUser('sub')`, and the service checks ownership before mutating.
4. Multi-row writes go through `runInTransaction`; broker events go through the outbox in that transaction; realtime emits and cache invalidation happen after the commit.
5. Wire types in `@repo/contracts`, request DTOs `implements` them, responses are DTOs, never entities.
6. Schema changes are migrations with explicit constraint names; every date column is `timestamptz`.
7. Every list is bounded: `limit` ≤ `PAGE_SIZE_MAX`, out of range → 400, stable `createdAt DESC, id DESC` order backed by an index, a constant number of queries per page.
8. Files are attached only as READY assets through `Asset.assertAttachableTo`, reached through a module-local port over `AssetsService`.

---

## Appendix: Project-Wide Pattern Reference

### A.1 Modules in `core_microservice`

| Module                | Ports and tokens (in `domain/interfaces/`)                                               | Adapters                                                                                                   | Notes                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`            | `UserProfileRepositoryKey`, `USER_DIRECTORY_PORT`, `AVATAR_ASSET_PORT`                   | `UserProfileRepository`, `UserDirectoryAdapter`, `AvatarAssetAdapter`                                      | reference layout; `ProfilesService` still injects the concrete repository and `ProfileSummaryCache`                                                               |
| `profile-summary`     | — (uses `FollowRepositoryKey`, `POST_REPOSITORY`, `ProfilesService`)                     | —                                                                                                          | `GET /profiles/by-user/:userId`, cache-aside read model (§3.14)                                                                                                   |
| `posts`               | `POST_REPOSITORY`                                                                        | `PostRepository`                                                                                           | keyset `findFeedPage` + `FeedCursor` (§3.12), batch `getLikeStats` / `getCommentCounts`; images checked through `AssetsService`; ownership checked in the service |
| `comments`            | `COMMENT_REPOSITORY` (`CommentTransaction`)                                              | `CommentRepository`                                                                                        | reply trees (`findRootPage`, `findRepliesOf`, `softDeleteWithReplies`); outbox `social.post.commented`                                                            |
| `likes`               | `POST_LIKE_REPOSITORY`, `COMMENT_LIKE_REPOSITORY`                                        | `PostLikeRepository`, `CommentLikeRepository`                                                              | entities owned by posts/comments; outbox `social.*.liked`                                                                                                         |
| `follows`             | `FollowRepositoryKey`                                                                    | `FollowRepository`                                                                                         | paged followers/following; counts invalidated after commit; outbox `social.user.followed`                                                                         |
| `assets`              | `FileStoragePortKey`, `UPLOAD_REPOSITORY`, `CONTENT_SNIFFER`                             | `S3StorageAdapter`, `UploadRepository`, `FileTypeContentSniffer`, `AssetRepository` (concrete, READY-only) | two-step uploads (§3.13), `PendingUploadSweeper`, public and private buckets, presigned GET and POST                                                              |
| `chats`               | `CHAT_REPOSITORY`, `MESSAGE_REPOSITORY`, `ATTACHMENT_STORAGE_PORT`, `CHAT_REALTIME_PORT` | `ChatRepository`, `MessageRepository`, `AttachmentStorageAdapter`, `ChatsGateway`                          | three services (chats, messages, membership); signed-URL cache; `SessionRevocationListener` registered here                                                       |
| `internal-events`     | —                                                                                        | —                                                                                                          | `POST /internal/events/user-created`                                                                                                                              |
| `notifications-relay` | —                                                                                        | `NotificationsRelayConsumer`                                                                               | `core.realtime-relay` → `emitToUser`                                                                                                                              |

`common/`:

- `auth/` (verifier provider, `CommonAuthModule`, `OptionalJwtAuthGuard`), `guards/jwt-auth.guard.ts`, `decorators/current-user.decorator.ts`, `dto/user-summary.dto.ts`
- `redis/` (`RedisModule`, `SessionRevocationListener`), `messaging/` (§3.11)
- `cache/` (`CacheModule`, `CACHE_STORE`, `ProfileSummaryCache`, §3.14)
- `db/` (`QueryContextMiddleware`, `TypeOrmPerfLogger`) and `perf/` (`QueryCountInterceptor`), §3.15
- `observability/` (`ObservabilityModule`, `MetricsModule`, `HealthController`, `MetricsController`, `InternalTokenGuard`, `checks/`, §8)
- `typeorm/bigint-number.transformer.ts`

### A.2 `auth_microservice` at a glance

| Layer            | Contents                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition      | `main.ts`, `app.ts` (`createApp`, `createInternalApp`)                                                                                                                                                   |
| Routes           | `/users` (`users.routes.ts`), `/auth` (`auth.routes.ts`), `/health`, `/health/details`, `/metrics` (`createObservabilityRouter` in `app.ts`), `/internal` (`internal.routes.ts`, internal listener only) |
| Middleware       | `requireAuth`, `validateBody`, `createErrorHandler`, `createInternalTokenMiddleware`; from `@repo/shared`: `requestIdMiddleware`, `accessLogMiddleware`, `httpMetricsMiddleware`, `requireInternalToken` |
| Services         | `UsersService`, `AuthService`                                                                                                                                                                            |
| Ports / adapters | table in §4.5                                                                                                                                                                                            |
| Health checks    | `infrastructure/health/{database,redis}.check.ts` (§8.2)                                                                                                                                                 |
| Entity           | `AuthUser` (`domain/entities/auth-user.entity.ts`)                                                                                                                                                       |
| Migrations       | `src/migrations/`, CLI via `apps/auth_microservice/data-source.ts`                                                                                                                                       |
| Seeds            | `seed/` (`npm run db:seed -w auth_microservice [-- --profile perf --reset]`)                                                                                                                             |
| Tests            | co-located `*.spec.ts`, `npm run test:cov` (70/60); no e2e suite                                                                                                                                         |

### A.3 Global Infrastructure in core `main.ts`

| Setting                                          | Value                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logger                                           | `new WinstonLogger('CoreSystem')` (`LOG_LEVEL`)                                                                                                                       |
| `requestIdMiddleware()`, `accessLogMiddleware()` | request id in `AsyncLocalStorage`, one access-log line per request (§8.6)                                                                                             |
| `helmet()`                                       | security headers                                                                                                                                                      |
| `httpMetricsMiddleware(registry)`                | request duration and error counters (§8.3)                                                                                                                            |
| `cookieParser()`                                 | cookie parsing                                                                                                                                                        |
| CORS                                             | origin `AppConfigService.clientUrl` (`CLIENT_URL`), `credentials: true`, methods GET/POST/PUT/PATCH/DELETE/OPTIONS, headers `Content-Type`, `Authorization`, `Accept` |
| Fail-fast asserts                                | `assertSafeForEnvironment()` (no `PERF_INSTRUMENTATION` in production), `assertInternalApiToken()` (32+ chars)                                                        |
| DB pool gauge                                    | `registerDbPoolGauge(registry, …)` → `db_pool_connections{state}`                                                                                                     |
| Pipe                                             | `ValidationPipe({ whitelist: true, transform: true })`                                                                                                                |
| Filter                                           | `DomainExceptionFilter(createErrorsCounter(registry))`                                                                                                                |
| Swagger                                          | `setupSwagger` (`src/swagger.ts`) → `/api` when `swaggerEnabled`                                                                                                      |
| Shutdown                                         | `enableShutdownHooks()`                                                                                                                                               |
| Port                                             | `AppConfigService.port` (`CORE_PORT`, 3001)                                                                                                                           |

Wired in `app.module.ts`, not `main.ts`: `QueryContextMiddleware` for all routes and `QueryCountInterceptor` as `APP_INTERCEPTOR` (§3.15). `test/helpers/app.helpers.ts` repeats the request-facing part of it for e2e (§3.7).

### A.4 TypeORM Entity Registration

- Runtime: each module's `TypeOrmModule.forFeature([...])`; the root `TypeOrmModule.forRootAsync` uses `autoLoadEntities: true` with `AppConfigService.postgres` (`synchronize: false`), `logging: ['query', 'error']`, `logger: new TypeOrmPerfLogger()` and `maxQueryExecutionTime: SLOW_QUERY_MS` (§3.15).
- Every date column is `timestamptz` (§3.2 Layer 1).
- CLI: `apps/core_microservice/data-source.ts` globs `src/**/*.entity{.ts,.js}` and `src/migrations/*{.ts,.js}`. The same layout holds for `apps/auth_microservice/data-source.ts` and `apps/notifications_consumer_microservice/data-source.ts`.

### A.5 DTOs in `@repo/shared`

| DTO                                                                                             | File                                                         | Used by                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| `CreateUserDto`                                                                                 | `packages/shared/src/dtos/auth/create-user.dto.ts`           | auth `POST /users/register`      |
| `LoginDto`                                                                                      | `packages/shared/src/dtos/auth/login.dto.ts`                 | auth `POST /auth/login`          |
| `GoogleLoginDto`                                                                                | `packages/shared/src/dtos/auth/google-login.dto.ts`          | auth `POST /auth/google`         |
| `UpdateProfileDto`                                                                              | `packages/shared/src/dtos/core/update-profile.dto.ts`        | core `PATCH /profiles/:id`       |
| `CreateCommentDto`                                                                              | `packages/shared/src/dtos/core/create-comment.dto.ts`        | core comments                    |
| `UpdateCommentDto`                                                                              | `packages/shared/src/dtos/core/update-comment.dto.ts`        | core comments                    |
| `PostsByAuthorQueryDto` (+ `POST_LIST_STATUSES`, `POSTS_BY_AUTHOR_MAX_LIMIT` = `PAGE_SIZE_MAX`) | `packages/shared/src/dtos/core/posts-by-author-query.dto.ts` | core `GET /posts/author/:userId` |

The `auth/` DTOs serve auth, and the `core/` DTOs serve only core. Refresh and logout take no DTO, since the token comes from the cookie (§4.3). Every other request DTO is module-local (`modules/<module>/dto/`).

### A.6 Domain Errors in `@repo/shared`

| Class                                                                                                                         | File                                                | Base          |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------- |
| `DomainError`                                                                                                                 | `packages/shared/src/errors/domain.error.ts`        | abstract      |
| `EntityNotFoundError`, `EntityByIdNotFoundError`, `UniqueConstraintViolationError`, `DatabaseQueryError`, `UnauthorizedError` | `packages/shared/src/errors/database.errors.ts`     | `DomainError` |
| `AccessDeniedError`                                                                                                           | `packages/shared/src/errors/access-denied.error.ts` | `DomainError` |

HTTP statuses: the table in §3.2 Layer 3.

### A.7 Contracts in `@repo/contracts`

| Area            | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `common`        | `PAGE_SIZE_MAX` (50), `CHANGES_PAGE_SIZE_MAX` (200), `IOffsetPage<T>`, `IUserSummary`; legacy and unused: `IPaginatedResponse`, `IPaginationMeta`, `PAGINATION_DEFAULTS`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `auth`          | `ILoginRequest`, `IRegisterRequest`, `IGoogleLoginRequest`, `IAuthUserResponse`, `ILoginResponse`, `IRegisterResponse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `profiles`      | `ICreateProfileRequest`, `IUpdateProfileRequest`, `ISearchProfilesQuery`, `IProfileResponse`, `IProfileSummaryResponse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `posts`         | `PostStatus`, `ICreatePostRequest`, `IUpdatePostRequest`, `IPostsByAuthorQuery`, `IFeedQuery` (`cursor`, `limit`), `IPostResponse`, `IPostAssetResponse`, `IFeedPage` (`items`, `nextCursor`)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `comments`      | `IListCommentsQuery`, `ICommentResponse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `likes`         | `ILikeState`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `follows`       | `ICreateFollowRequest`, `IFollowListQuery`, `IFollowResponse`, `IFollowListItem` (adds `isFollowedByMe`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `assets`        | `IAssetResponse` (confirm result for `post-image` and `avatar`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `uploads`       | `UploadPurpose` (`post-image`, `avatar`, `chat-attachment`), `ICreateUploadRequest`, `IUploadTicket`; constants `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWLIST`, `UPLOAD_LINK_TTL_SECONDS` (unused; the live TTL is `UPLOAD_LINK_TTL_SEC` in core config)                                                                                                                                                                                                                                                                                                                                                                               |
| `chats`         | requests: `ICreateDirectChatRequest`, `ICreateGroupChatRequest`, `IListChatsQuery`, `IRenameGroupRequest`, `IAddMembersRequest`, `IListMessagesQuery`, `IMessageChangesQuery`, `ISendMessageRequest`, `IEditMessageRequest`, `IMarkReadRequest`; responses: `IMessage`, `IMessageResponse`, `IChatUser`, `IChatParticipant`, `IAttachment`, `IConversationSummary`, `IConversationDetail`, `ICursorPage`, `IReadState`, `IUploadedAttachment` (also the confirm result for `chat-attachment`), `IAttachmentUrl`, `ChatType`, `ParticipantRole`, `SystemEventType`; constants `MESSAGE_MAX_ATTACHMENTS`, `ATTACHMENT_MAX_BYTES` |
| `notifications` | `IListNotificationsQuery` (`before` = opaque cursor, bare ISO still accepted), `IMarkSeenRequest`, `NotificationKind`, `INotification`, `INotificationPreferences`, `INotificationsPage` (`items`, `hasMore`, `unseenCount`, `nextCursor`), `IUnseenCount`                                                                                                                                                                                                                                                                                                                                                                     |
| `observability` | `HealthStatus`, `IHealthStatus`, `IHealthCheckResult`, `IHealthReport`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `realtime`      | `REALTIME_NAMESPACE`, `ServerToClientEvents` (`message:new`, `message:updated`, `message:deleted`, `chat:upsert`, `chat:removed`, `chat:read`, `chat:alert`, `typing`, `notification:new`, `notifications:seen`, `session:expired`), `ClientToServerEvents` (`chat:view`, `typing:start`, `typing:stop`, `auth:renew`), `IRealtimeAckError`                                                                                                                                                                                                                                                                                    |

---

_This guide reflects the architecture as of 2026-10-26. If you find discrepancies between the guide and the code, the code is authoritative: update the guide._
