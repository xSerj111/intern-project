# DDD & Hexagonal Architecture Guide — Innogram Monorepo

**Audience:** Backend and full-stack developers working in the Innogram codebase.  
**Last updated:** 2026-10-14  
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
│   └── shared/                               # @repo/shared: backend-only infrastructure
├── docker/postgres/init-databases.sh         # creates innogram_auth / innogram_core / innogram_notifications
├── docker-compose.yml                        # Postgres, Redis, SeaweedFS, RabbitMQ, Mailpit (infrastructure only)
├── turbo.json
└── package.json                              # npm workspaces: apps/*, packages/*
```

### 1.2 Architectural Styles

| Service | Framework | DI | Database | Layout |
|---|---|---|---|---|
| `auth_microservice` | Express | Manual, in `createApp()` / `createInternalApp()` | `innogram_auth` | `src/{config,domain,infrastructure,middleware,routes,services,types}` |
| `core_microservice` | NestJS | Nest IoC, ports bound to `Symbol` tokens | `innogram_core` | `src/modules/<module>/{domain,dto,infrastructure}` (§3) |
| `notifications_consumer_microservice` | NestJS | Nest IoC, ports bound to `Symbol` tokens | `innogram_notifications` | `src/modules/<module>/{domain,application,infrastructure}` (§5) |
| `client_app` | Next.js | — | — | `src/{app,components,lib}` |

All three backends follow Ports & Adapters: domain entities and port interfaces in `domain/`, adapters in `infrastructure/`, application services that depend on ports only. Each service owns its database and its port variable (`AUTH_PORT` 3002, `CORE_PORT` 3001, `NOTIFICATIONS_PORT` 3003, `CLIENT_PORT` 3000); no service reads another service's database.

### 1.3 How Services Talk to Each Other

```
 client_app ── HTTP ──────────────────▶ auth           (:3002)
 client_app ── HTTP + Socket.IO /realtime ─▶ core   (:3001, ChatsGateway)
 client_app ── HTTP ──────────────────▶ notifications (:3003)

 auth ── POST /internal/events/user-created (fire-and-forget) ──▶ core
 auth ── Redis pub/sub "auth:session-revoked" ──────────────────▶ core (closes sockets)
 core ── outbox → RabbitMQ exchange innogram.events ─────────────▶ notifications (social.#, chat.message.alerted)
 notifications ── innogram.events notification.* ───────────────▶ core relay ─▶ user:{id} room
 notifications ── GET /internal/users/:id/contact (X-Internal-Token) ─▶ auth internal listener (:3012)
```

| Channel | Producer → consumer | Delivery | Details |
|---|---|---|---|
| `POST /internal/events/user-created` | auth → core | HTTP, fire-and-forget, no retry | §7 |
| `auth:session-revoked` | auth → core | Redis pub/sub, not durable | §3.10 |
| `innogram.events` (`social.*`, `chat.message.alerted`) | core → notifications | transactional outbox, at-least-once | §3.11 |
| `innogram.events` (`notification.created`, `notification.seen`) | notifications → core | AMQP, relayed to sockets | §3.11 |
| `GET /internal/users/:id/contact` | notifications → auth | HTTP on an internal-only listener | §4.7 |

### 1.4 How Turborepo Orchestrates Builds

`turbo.json` (Turborepo 1.x, so the top-level key is `pipeline`, not `tasks`):

```jsonc
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "build/**"] },
    "dev":   { "dependsOn": ["^build"], "cache": false, "persistent": true },
    "test":  { "dependsOn": ["^build"] },
    "lint":  {},
    "type-check": { "dependsOn": ["^build"] }
  }
}
```

`^build` builds a workspace's dependencies first, so `@repo/contracts` and `@repo/shared` produce their `dist/` before any app builds. The apps consume those packages through `dist/` (`main`/`types` point at `dist/index.js`), so running one app standalone needs `npm run build -w @repo/shared -w @repo/contracts` first; a stale `dist/` shows up as confusing type errors. `core_microservice` type-checks against `../shared/src` through tsconfig paths, so `npx tsc --noEmit -p apps/core_microservice/tsconfig.json` works without a rebuild.

---

## 2. The Package Ecosystem: `@repo/contracts` vs. `@repo/shared`

### 2.1 `@repo/contracts`: the wire format

| Property | Value |
|---|---|
| Dependencies | none |
| Consumed by | `client_app` and every backend |
| Purpose | Request/response interfaces, realtime event maps, a few shared constants |

One folder per area under `packages/contracts/src/` (`auth`, `chats`, `comments`, `common`, `follows`, `likes`, `notifications`, `posts`, `profiles`, `realtime`), each with `requests.ts` / `responses.ts` and an `index.ts`, re-exported from `packages/contracts/src/index.ts`. Interfaces are plain TypeScript: no decorators, no runtime libraries, dates as ISO strings.

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

| Property | Value |
|---|---|
| Dependencies | `@nestjs/common`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `typeorm`, `winston`, `jsonwebtoken` |
| Consumed by | backends only, **never** `client_app` |

```
packages/shared/src/
├── index.ts                        # barrel export
├── auth/access-token.verifier.ts   # AccessTokenVerifier (JWT verify + blacklist check), VerifyResult
├── database/                       # TypeormEntityBase, RepositoryPort, TypeormRepositoryBase, PostgresErrorCode, isTypeOrmError
├── dtos/{auth,core}/               # class-validator DTOs shared by Express and Nest (A.5)
├── errors/                         # DomainError, database errors, AccessDeniedError (A.6)
├── events/                         # UserCreatedEvent, SessionRevokedEvent, EventEnvelope, RoutingKeys, broker payloads, EmailJob
├── filters/domain-exception.filter.ts  # DomainExceptionFilter (Nest)
├── logger/                         # Logger port, LoggerKey, LoggerModule, WinstonLogger
└── redis/redis-keys.ts             # RedisKeys, secondsUntil (key layout shared by auth and core)
```

`packages/shared` source uses double quotes; match the file you edit. Some types exist in both packages on purpose (`NotificationKind`): `@repo/shared` cannot depend on `@repo/contracts`, so it re-declares them structurally. Alias one of them when a file imports both.

### 2.3 The Decisive Rule: Where Do New Types Go?

| If the type... | It goes in... | Because... |
|---|---|---|
| describes an HTTP request/response or a realtime event payload | `@repo/contracts` | the frontend needs it without backend dependencies |
| is a `class-validator` DTO used by both Express and Nest (auth DTOs, `UpdateProfileDto`) | `packages/shared/src/dtos/` | it depends on `class-validator` |
| is a request/response DTO used by one core module | the module's `dto/` folder | module-specific |
| is an entity, props interface, port or domain error | the module's `domain/` folder | module-specific |
| is a cross-service event class (validated) | `packages/shared/src/events/` | both producer and consumer validate it |
| is a Redis key or channel shared by auth and core | `packages/shared/src/redis/redis-keys.ts` | both services must agree on the string |

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
│   │   └── user-directory.port.ts             # IUserDirectoryPort + USER_DIRECTORY_PORT (cross-module, §3.4)
│   └── errors/user-profile.errors.ts
├── dto/{create-profile.dto.ts, profile-response.dto.ts, search-profiles-query.dto.ts}
├── infrastructure/
│   ├── repository/user-profile.repository.ts  # TypeORM adapter
│   └── user-directory.adapter.ts              # IUserDirectoryPort adapter
└── __tests__/fakers/{index.ts, user-profile.faker.ts}
```

Larger modules add `infrastructure/realtime/` (chats gateway) and `infrastructure/storage/` (assets, chat attachments), and split services by use case (`chats.service.ts`, `messages.service.ts`, `chat-membership.service.ts`).

A request flows: **controller** (HTTP mapping, DTO validation) → **service** (orchestration, loading, transactions, emits) → **entity method** (business rule, throws `DomainError`) → **repository port** (bound to a TypeORM adapter by a `Symbol` token) → **`DomainExceptionFilter`** (maps `DomainError` to HTTP).

### 3.2 The Layers

#### Layer 1: Domain Entities (`domain/entities/`)

Entities are both domain objects and TypeORM entities: they extend `TypeormEntityBase` (`id` uuid, `createdAt`, `updatedAt`, `deletedAt`). Construction goes through a `static create()` factory; every rule is an entity method that throws a `DomainError` subclass.

```typescript
// apps/core_microservice/src/modules/profiles/domain/entities/user-profile.entity.ts
@Entity('user_profiles')
export class UserProfile extends TypeormEntityBase implements UserProfileProps {
  @Index()
  @Column({ type: 'uuid', unique: true })
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

Other examples: `Post.publish()` / `archive()` / `assertLikeableBy()`, `Comment.edit()` / `notifiesPostAuthor()`, `Chat.assertCanRead()` / `addMembers()` / `leave()`, `Follow.notifiesFollowed()`.

Conventions:
- Never call `new Entity()` outside its factory or a test faker.
- Cross-module references use `import type` and a string relation target, so modules don't import each other's entities at runtime: `@ManyToOne('UserProfile')`.
- Columns that point at a user store the **auth user id** (the JWT `sub`) and reference `user_profiles."authUserId"`, not `user_profiles.id`. Give FKs, indexes and unique constraints explicit names so `migration:generate` stays drift-free:

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
  getFeedForAuthors(authorIds: string[], page: number, limit: number): Promise<[Post[], number]>;
  getLikeStats(postIds: string[], viewerId?: string): Promise<Map<string, LikeStats>>;
}

export const POST_REPOSITORY = Symbol.for('IPostRepository');
```

`RepositoryPort` (`packages/shared/src/database/repository.port.ts`) covers `findOne`, `findOneOrThrow`, `findOneByIdOrThrow`, `findMany`, `findManyPaginated`, `save`, `saveMultiple`, `delete`, `deleteMultiple`, `deleteByCriteria`, `softDelete`, `count`, `exists`, `upsert`. Ports with very specific persistence (chats, likes, outbox) don't extend it and declare exactly the operations they need.

Non-repository ports follow the same shape: `IFileStoragePort` / `FileStoragePortKey`, `IAttachmentStoragePort` / `ATTACHMENT_STORAGE_PORT`, `IChatRealtimePort` / `CHAT_REALTIME_PORT`, `IUserDirectoryPort` / `USER_DIRECTORY_PORT`.

#### Layer 3: Domain Errors (`domain/errors/`) and the HTTP Mapping

Module errors go in `domain/errors/<module>.errors.ts` (a few older ones sit next to their entity, e.g. `EmptyCommentError`, `InvalidPostStateError`). All extend `DomainError` (`packages/shared/src/errors/domain.error.ts`), an abstract class with a `protected` constructor that sets `name` to the subclass name. Pick the base class by the status you want; subclasses inherit the mapping:

```typescript
// apps/core_microservice/src/modules/chats/domain/errors/chat.errors.ts
export class ChatNotFoundError extends EntityNotFoundError { ... }   // 404
export class NotChatAdminError extends AccessDeniedError { ... }     // 403
export class MessageTooLongError extends DomainError { ... }         // 400
```

**Error mapping (the one table).** Nest services register `DomainExceptionFilter` from `packages/shared/src/filters/domain-exception.filter.ts` globally (core and notifications); auth uses `apps/auth_microservice/src/middleware/error-handler.middleware.ts`. Both check `instanceof` in this order:

| Error (and its subclasses) | Nest `DomainExceptionFilter` | Express `errorHandler` |
|---|---|---|
| `EntityNotFoundError`, `EntityByIdNotFoundError` (e.g. `ChatNotFoundError`, `MessageNotFoundError`, `UserNotFoundError`) | 404 | 404 |
| `AccessDeniedError` (e.g. `NotChatAdminError`, `NotMessageAuthorError`) | 403 | 403 |
| `UniqueConstraintViolationError` | 409 | 409 |
| `DatabaseQueryError` | 500 (logged at error level) | 500 |
| `UnauthorizedError` | **400** (no special case) | 401 |
| any other `DomainError` (e.g. `InvalidDisplayNameError`, `MessageTooLongError`) | 400 | 400 |
| not a `DomainError` | not caught: Nest's default handling (an `HttpException` keeps its status, anything else is 500) | 500 `{ statusCode: 500, message: 'Internal Server Error' }` |

Body for mapped errors: `{ statusCode, error: <error class name>, message }`. On the socket, `WsDomainExceptionFilter` (`apps/core_microservice/src/modules/chats/infrastructure/realtime/ws-domain-exception.filter.ts`) acks `{ ok: false, error: { code: <class name>, message } }`, and `InternalError` for anything else.

Domain code never throws `HttpException`. Nest exceptions appear only at the HTTP edge: `JwtAuthGuard` (401/503) and the legacy ownership checks in profiles/posts/comments (`ForbiddenException`, §3.6). For a new 403 rule, extend `AccessDeniedError` instead.

#### Layer 4: DTOs (`dto/`)

Request DTOs implement the contracts interface and carry `class-validator` and `@ApiProperty` decorators. The global `ValidationPipe` is `{ whitelist: true, transform: true }`: **an undecorated property is silently stripped.**

```typescript
// apps/core_microservice/src/modules/chats/dto/edit-message.dto.ts
export class EditMessageDto implements IEditMessageRequest {
  @ApiProperty({ description: 'New message text (0-2000 chars); blank only if attachments' })
  @IsString({ message: 'Content must be a text' })
  @MaxLength(2000, { message: 'Message is too long (max 2000 chars)' })
  content!: string;
}
```

Response DTOs take the entity in the constructor and normalise it for the wire: dates → `toISOString()`, optional fields → `?? null`, internal columns such as `deletedAt` left out. Controllers never return entities.

```typescript
// apps/core_microservice/src/modules/profiles/dto/profile-response.dto.ts
constructor(profile: UserProfile) {
  this.id = profile.id;
  this.bio = profile.bio ?? null;
  this.createdAt = profile.createdAt.toISOString();
  // ...
}
```

Chats builds responses through functions in `apps/core_microservice/src/modules/chats/dto/chat-response.mapper.ts` (`toMessageResponse`, `toConversationSummary`, `presignAttachments`) because they need user maps and presigned URLs.

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

  constructor(@InjectRepository(UserProfile) repository: Repository<UserProfile>) {
    super(repository);
  }

  public async findByAuthUserId(authUserId: string): Promise<UserProfile | null> {
    return this.repository.findOne({ where: { authUserId } });
  }
}
```

`TypeormRepositoryBase` (`packages/shared/src/database/typeorm-repository.base.ts`) wraps a `Repository<Entity>` and implements `RepositoryPort`: it resolves the default `relations`, logs persistence calls, throws `EntityByIdNotFoundError` / `EntityNotFoundError` from the `...OrThrow` finders, and in `save` translates a Postgres unique violation into `UniqueConstraintViolationError` and anything else into `DatabaseQueryError`.

Adapters with hand-written SQL (`chat.repository.ts`, `message.repository.ts`, `post-like.repository.ts`, `typeorm-outbox.adapter.ts`) are covered against Postgres by e2e suites under `apps/core_microservice/test/`, not only by mocked unit specs.

#### Layer 6: Service

Services orchestrate: load through ports, call entity methods, persist, write outbox rows, emit realtime events after the commit, log. They contain no business rules, and they receive the caller's id (`user.sub`) as an argument.

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

The logger is `@Inject(LoggerKey) logger: Logger` and needs `LoggerModule.forFeature('<Name>')` in the module's imports; log with `this.logger.debug('Comment created', { props: { commentId } })`.

#### Layer 7: Controller

Controllers map HTTP to service calls and entities to response DTOs. They inject **services only**, never repositories or ports.

```typescript
// apps/core_microservice/src/modules/chats/messages.controller.ts
@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats/:chatId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Patch(':messageId')
  @ApiOperation({ summary: 'Edit your own message' })
  edit(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messagesService.edit(userId, chatId, messageId, dto);
  }
}
```

Route ids go through `ParseUUIDPipe`; status codes other than the default use `@HttpCode` (or `@Res({ passthrough: true })` when it depends on the result, as `POST /chats/:chatId/messages` does for 201 vs 200 on a replay).

#### Layer 8: Module

```typescript
// apps/core_microservice/src/modules/posts/posts.module.ts
@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostLike, PostAsset]),
    LoggerModule.forFeature('PostsService'),
    FollowsModule, // exports FollowRepositoryKey
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

Every module lists its entities in `TypeOrmModule.forFeature([...])` (the root uses `autoLoadEntities: true`) and is imported by `apps/core_microservice/src/app.module.ts`.

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
- `{ provide: TOKEN, useClass: Adapter }` when only the token is needed (`CHAT_REPOSITORY`, `MESSAGE_REPOSITORY`, `ATTACHMENT_STORAGE_PORT`, `POST_LIKE_REPOSITORY`, `USER_DIRECTORY_PORT`, `FileStoragePortKey`, `OUTBOX_PORT`, `EVENT_BUS`).
- `{ provide: TOKEN, useExisting: Adapter }` plus the adapter class as its own provider when the same instance must be reachable both ways. `CHAT_REALTIME_PORT` → `ChatsGateway` needs this: Nest must instantiate the gateway as a gateway, and services must reach that same instance through the port. Repositories bound this way (`POST_REPOSITORY`, `COMMENT_REPOSITORY`, `FollowRepositoryKey`, `UserProfileRepositoryKey`) are still injected by token.

Use `Symbol.for('IName')` for new tokens. Export the token (not the adapter) when another module needs the port, as `PostsModule` exports `POST_REPOSITORY`.

In tests the token makes faking trivial: `{ provide: POST_REPOSITORY, useValue: { findById: jest.fn(), save: jest.fn() } }` plus `{ provide: LoggerKey, useValue: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }`.

Two older services still inject a concrete repository class: `ProfilesService` (`UserProfileRepository`) and `AssetsService` (`AssetRepository`). Don't copy that. `InternalEventsController` calls `ProfilesService` directly; `ChatsGateway` is injected as a class by `SessionRevocationListener` (same module). Everything else goes through tokens.

### 3.4 Module Map and Cross-Module Ports

| Module | Owns | Exposes to other modules |
|---|---|---|
| `profiles` | `UserProfile`, profile search, by-ids lookup, lazy profile creation, avatar rules (`AVATAR_ASSET_PORT` over `AssetsService`) | `ProfilesService`, `USER_DIRECTORY_PORT` |
| `profile-summary` | `GET /profiles/by-user/:userId` (profile + follower/following/published-post counts). Separate module because follows and posts already import profiles | — |
| `posts` | `Post`, `PostLike` and `PostAsset` entities, feed, search | `POST_REPOSITORY` |
| `comments` | `Comment`, `CommentLike` entities | `COMMENT_REPOSITORY` |
| `likes` | like/unlike routes and the like repositories (entities belong to posts/comments) | — |
| `follows` | `Follow` | `FollowsService`, `FollowRepositoryKey` |
| `assets` | `Asset`, S3 storage (SeaweedFS locally), private bucket presigning | `AssetsService` |
| `chats` | `Chat`, `ChatParticipant`, `Message`, `MessageAttachment`, `ChatsGateway` | `CHAT_REALTIME_PORT` |
| `internal-events` | `POST /internal/events/user-created` | — |
| `notifications-relay` | AMQP consumer for `notification.*` → sockets | — |

Global infrastructure (no import needed): `AppConfigModule` (`AppConfigService`), `RedisModule` (`REDIS_CLIENT`), `CommonAuthModule` (`ACCESS_TOKEN_VERIFIER`), `MessagingModule` (`OUTBOX_PORT`, `EVENT_BUS`, `AMQP_CONNECTION`).

**`USER_DIRECTORY_PORT`** is how other modules read user profiles without touching profile tables:

```typescript
// apps/core_microservice/src/modules/profiles/domain/interfaces/user-directory.port.ts
export interface IUserDirectoryPort {
  /** Unknown ids are simply absent from the returned map. */
  getUsers(userIds: string[]): Promise<Map<string, IChatUser>>;
  /** @throws UserNotFoundError listing the ids that have no profile. */
  assertUsersExist(userIds: string[]): Promise<void>;
}
export const USER_DIRECTORY_PORT = Symbol.for('IUserDirectoryPort');
```

`UserDirectoryAdapter` (`apps/core_microservice/src/modules/profiles/infrastructure/user-directory.adapter.ts`) does one `IN` query per call. Chats uses it for participant snapshots and member validation, comments/likes/follows/messages for the actor snapshot in broker events, and the gateway for the typing user. A module that needs it imports `ProfilesModule`.

The same idea applies to storage: chats never touches `Asset` directly. `ATTACHMENT_STORAGE_PORT` is bound to `AttachmentStorageAdapter` (`apps/core_microservice/src/modules/chats/infrastructure/storage/attachment-storage.adapter.ts`), which wraps the exported `AssetsService`.

### 3.5 Transactional Repository Ports

When a use case writes several rows that must commit together (a message plus its attachments plus outbox rows; a like plus its outbox row), the port exposes `runInTransaction` and each write takes an optional transaction handle:

```typescript
// apps/core_microservice/src/modules/chats/domain/interfaces/chat-repository.port.ts
/** Opaque transaction handle passed between the chat and message ports. */
export type ChatTransaction = EntityManager;

export interface IChatRepository {
  save(chat: Chat, tx?: ChatTransaction): Promise<Chat>;
  advanceReadSeq(chatId: string, userId: string, seq: number, tx?: ChatTransaction): Promise<number>;
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

The same shape is used by `ICommentRepository` (`CommentTransaction`), `IFollowRepository`, `IPostLikeRepository` and `ICommentLikeRepository`; `IMessageRepository` has no `runInTransaction` of its own and takes the chat repository's `tx` in every write. Adapters implement `save(e, tx?)` as "`tx.getRepository(E).save(e)` when given, else the base `save`"; inside a transaction raw errors propagate and the service's wrapper maps non-domain errors to `DatabaseQueryError`.

**Why `EntityManager` in a domain port is accepted.** The handle type is TypeORM's, so the domain layer technically knows its ORM. The alternative, a unit-of-work abstraction over every adapter plus the outbox, would add a layer for no practical gain: TypeORM is the only persistence used, entities are already TypeORM entities, and the domain code only passes the handle along and never calls it. The alias (`ChatTransaction`, `CommentTransaction`) keeps call sites readable and gives one place to change if that ever stops being true.

Rules for chats sequence and read-pointer columns: never persist `chats.lastSeq` or a participant's `lastReadSeq`/`joinedSeq` through a cascading `chats.save(chat)`, because the graph was loaded outside the row lock and a save can rewind a concurrent `allocateSeq`. Use the narrow writes on the port: `allocateSeq` (also for `changeSeq`), `advanceReadSeq`, `findByIdForUpdate`, `upsertActiveMember`, `markParticipantLeft`, `setParticipantRole`, `setTitle`.

### 3.6 Authentication, `@CurrentUser` and IDOR

**Guard.** `JwtAuthGuard` (`apps/core_microservice/src/common/guards/jwt-auth.guard.ts`) delegates to the shared `AccessTokenVerifier`, injected by the `ACCESS_TOKEN_VERIFIER` token from the global `CommonAuthModule` (`apps/core_microservice/src/common/auth/common-auth.module.ts`):

```typescript
// apps/core_microservice/src/common/guards/jwt-auth.guard.ts
const result = await this.verifier.verify(this.extractTokenFromHeader(request));
if (!result.ok) {
  switch (result.reason) {
    case 'missing':     throw new UnauthorizedException('Authentication token is missing');
    case 'revoked':     throw new UnauthorizedException('Token has been revoked');
    case 'unavailable': throw new ServiceUnavailableException('Unable to verify token status, try again later');
    default:            throw new UnauthorizedException('Invalid or expired authentication token');
  }
}
request['user'] = result.payload; // { sub, email, jti, sid?, exp }
```

`AccessTokenVerifier` (`packages/shared/src/auth/access-token.verifier.ts`) verifies HS256 with `JWT_ACCESS_SECRET` (falling back to `JWT_SECRET`, the name auth signs with), requires `jti`, `sub` and `exp`, then checks Redis `blacklist:access:<jti>`. If Redis throws, the result is `unavailable` and the guard **fails closed with 503**. The provider (`apps/core_microservice/src/common/auth/access-token-verifier.provider.ts`) throws at startup when no secret is configured. Because `CommonAuthModule` and `RedisModule` are global, any module can use `@UseGuards(JwtAuthGuard)` without extra imports.

`OptionalJwtAuthGuard` (`apps/core_microservice/src/common/auth/optional-jwt-auth.guard.ts`) is for public routes that personalise the response (`GET /posts/:id`, `/posts/search`, `/comments/post/:postId` compute `likedByMe`): any failure leaves `request.user` unset and the request continues anonymously.

**`@CurrentUser()`** (`apps/core_microservice/src/common/decorators/current-user.decorator.ts`) returns `request.user`, or one field: `@CurrentUser('sub') userId: string`.

**IDOR.** Every mutating route uses `JwtAuthGuard` and passes `user.sub` into the service; the check that the caller owns or may touch the resource happens before the mutation. Where it lives today:

| Module | Check | Throws |
|---|---|---|
| chats | entity methods: `Chat.assertCanRead/assertCanPost` (non-members get 404, so chat ids don't leak), `Chat` admin checks, `Message.edit/delete` | `ChatNotFoundError` (404), `NotChatAdminError` / `NotMessageAuthorError` (`AccessDeniedError`, 403) |
| likes | `Post.assertLikeableBy`, `Comment.assertLikeableBy` (an unpublished post is visible to its author only) | `EntityByIdNotFoundError` (404) |
| follows | scoped by construction: the follower is always `user.sub` | — |
| posts, comments | service compares `authorId !== userId` | Nest `ForbiddenException` (403) |
| profiles | `UserProfile.assertOwnedBy` (called from `ProfilesService.updateProfile`), `UserProfile.changeAvatar` (asset must be the owner's, public, a non-SVG image) | `NotProfileOwnerError`, `AvatarAssetNotOwnedError` (`AccessDeniedError`, 403) |
| posts (by author) | `Post.assertStatusListableBy`: non-published statuses are listed for the author only | `PostStatusNotVisibleError` (`AccessDeniedError`, 403) |

New code follows the chats pattern: an entity method such as `assertOwnedBy(userId)` throwing an `AccessDeniedError` subclass, called from the service (§8 steps 3, 4 and 8).

### 3.7 App-Level Bootstrap (`main.ts`)

```typescript
// apps/core_microservice/src/main.ts (excerpt)
const app = await NestFactory.create(AppModule, { logger: new WinstonLogger('CoreSystem') });
app.use(helmet());
app.use(cookieParser());
app.enableCors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
});
const appConfig = app.get(AppConfigService);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.useGlobalFilters(new DomainExceptionFilter());
// Swagger at /api
app.enableShutdownHooks(); // runs onModuleDestroy/onApplicationShutdown (outbox relay, AMQP, Redis)
await app.listen(appConfig.port); // CORE_PORT, default 3001
```

The gateway reads `CLIENT_URL` lazily for its own CORS (decorator options are evaluated before config loads). Everything else reads configuration through `AppConfigService` (`apps/core_microservice/src/config/app-config.service.ts`: `port`, `postgres`, `redis`, `rabbitmq`, `outbox`, `s3`), never `process.env`.

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
this.emitToChat(chatId, 'message:updated', { message: response }); // post-commit, guarded
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
  socket.emit('session:expired', { reason: 'revoked' });
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

| Piece | File | Role |
|---|---|---|
| `IOutboxPort` / `OUTBOX_PORT` | `outbox.port.ts` | `add(routingKey, payload, tx)` for services; `claimPending`, `markPublished`, `markFailed`, `recordError`, `markDead`, `purgePublished` for the relay |
| `TypeOrmOutboxAdapter` | `typeorm-outbox.adapter.ts` | `FOR UPDATE SKIP LOCKED` claim, post-commit wake signal |
| `OutboxEvent` | `outbox-event.entity.ts` | table `outbox_events` (`attempts`, `lastError`, `publishedAt`, `deadLetteredAt`) |
| `EventBusPort` / `EVENT_BUS`, `EventRejectedError` | `event-bus.port.ts` | publish an `EventEnvelope`; resolves on broker confirm |
| `AmqpEventBus` | `amqp-event-bus.ts` | amqp-connection-manager confirm channel, 10 s timeout |
| `OutboxRelay` | `outbox-relay.ts` | 500 ms poll + wake, batch 100, backoff 1 s → 30 s, hourly purge of rows published over 7 days ago |
| `MessagingModule` | `messaging.module.ts` | `@Global()`; exports `OUTBOX_PORT`, `EVENT_BUS`, `AMQP_CONNECTION` |

**Failure rules in the relay.** A broker-side failure (broker down, nack, confirm timeout, closed channel) only records `lastError` (`recordError`) and backs off; it never counts toward dead-lettering, so an outage of any length can't kill healthy rows. Only `EventRejectedError` (the event itself can't be published, e.g. its payload can't be serialized) counts: `markFailed` bumps `attempts`, and at `OUTBOX_MAX_ATTEMPTS` (env, default 10, `AppConfigService.outbox.maxAttempts`) the row is `markDead` (sets `deadLetteredAt`), logged at error level and skipped. The relay lives in the non-global `OutboxRelayModule` so it stops and finishes its drain before the AMQP providers close.

**Envelope and payloads** come from `@repo/shared` (`packages/shared/src/events/event-envelope.ts`): `EventEnvelope<T> { eventId (= outbox row id), type (= routing key), version: 1, occurredAt, payload }`, `EXCHANGE_NAME = 'innogram.events'`, `RoutingKeys` (`social.post.commented`, `social.post.liked`, `social.comment.liked`, `social.user.followed`, `chat.message.alerted`, `notification.created`, `notification.seen`). Payload classes carry `class-validator` decorators because consumers validate them.

**Producers.** `CommentsService`, `LikesService`, `FollowsService` (social events, one row per notification-worthy action) and `MessagesService.send` (one `chat.message.alerted` row per active participant who isn't the author and isn't viewing the chat; the same set gets a `chat:alert` socket event after commit).

**Back into core.** `NotificationsRelayConsumer` (`apps/core_microservice/src/modules/notifications-relay/notifications-relay.consumer.ts`) binds `core.realtime-relay` to `notification.#` on its own channel of `AMQP_CONNECTION` and turns `notification.created` into `notification:new` and `notification.seen` into `notifications:seen` via `CHAT_REALTIME_PORT.emitToUser`. It stores nothing. `NOTIFICATIONS_RELAY_QUEUE` overrides the queue name (a non-default name is declared non-durable and auto-delete; e2e suites use one per run).

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
│   ├── jwt/jwt.service.ts                             # JwtService implements IJwtService
│   ├── oauth/google-oauth.service.ts                  # GoogleOAuthService implements IOAuthService
│   └── repositories/auth-user.repository.ts           # AuthUserRepository implements IAuthUserRepository
├── middleware/                   # auth (requireAuth), validate (validateBody), error-handler, internal-token
├── routes/                       # auth.routes.ts, users.routes.ts, internal.routes.ts (router factories)
├── services/                     # AuthService, UsersService (+ auth.service.spec.ts)
├── migrations/
└── types/express.d.ts            # req.user augmentation
```

Same layering as core, without decorators: services depend on port interfaces from `domain/interfaces/`, adapters in `infrastructure/` implement them, and the composition root wires them with `new`.

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
const cryptoService = new BcryptService(env.crypto.saltRounds);
const authUserRepository = new AuthUserRepository(dataSource);
const usersService = new UsersService(authUserRepository, logger, cryptoService, new HttpEventPublisher(logger));
const authService = new AuthService(
  usersService, redisService, logger, cryptoService,
  new JwtService(), new GoogleOAuthService(),
  new RedisSessionRevocationPublisher(sessionRedisClient, logger),
);
app.use('/users', createUsersRouter(usersService));
app.use('/auth', createAuthRouter(authService));
app.use(errorHandler); // last
```

Before the routers it applies `helmet()`, `express.json()`, CORS from `env.app.allowedOrigins` (`AUTH_ALLOWED_ORIGINS`) and Swagger (`swagger-jsdoc` over the `@openapi` JSDoc blocks in `routes/`).

Configuration lives only in `apps/auth_microservice/src/config/env.ts`: `requireEnv(key, default?)` throws on a missing variable, and the rest of the code reads the exported `env` object, never `process.env`. Add new variables there and to `.env.example`. Specs that import anything loading `env` set the required variables (`CORE_SERVICE_URL`, `AUTH_ALLOWED_ORIGINS`, `INTERNAL_API_TOKEN`, ...) before the import.

### 4.3 Routes, Validation and Errors

Routers are factories that receive their service:

```typescript
// apps/auth_microservice/src/routes/auth.routes.ts (excerpt)
export function createAuthRouter(authService: AuthService): Router {
  const router = Router();
  router.post('/login', validateBody(LoginDto), async (req, res, next) => {
    try {
      const { email, password } = req.body as LoginDto;
      const result = await authService.login(email, password, sessionContext(req)); // { ipAddress, userAgent }
      res.status(200).json(result);
    } catch (error) {
      next(error); // → errorHandler
    }
  });
  router.get('/me', requireAuth(authService), (req, res) => { /* req.user */ });
  return router;
}
```

Routes: `POST /users/register`, `GET /users/:id`, `POST /auth/login`, `POST /auth/google`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/logout`, and on the internal listener `GET /internal/users/:id/contact`.

- `validateBody(DtoClass)` (`apps/auth_microservice/src/middleware/validate.middleware.ts`) runs `plainToInstance` + `validate` and answers 400 `{ statusCode, error: 'Bad Request', message: string[] }`; on success `req.body` is the DTO instance. DTOs come from `@repo/shared` (`LoginDto`, `CreateUserDto`, `GoogleLoginDto`, `RefreshTokenDto`).
- `requireAuth(authService)` (`apps/auth_microservice/src/middleware/auth.middleware.ts`) reads the Bearer token, calls `authService.verifyToken` (signature + access blacklist) and sets `req.user`; failures are `UnauthorizedError` → 401.
- `errorHandler` maps errors with the table in §3.2 Layer 3.

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

| Port (`domain/interfaces/`) | File | Adapter |
|---|---|---|
| `IAuthUserRepository` (extends `RepositoryPort`) | `auth-user-repository.interface.ts` | `AuthUserRepository` (`TypeormRepositoryBase`, `super(dataSource.getRepository(AuthUser))`) |
| `ICacheService` (`get`, `setWithExpiry`, `delete`, `has`, `getOrSet`) | `cache.service.ts` | `RedisService` (ioredis) |
| `ICryptoService` | `crypto.service.interface.ts` | `BcryptService` |
| `IJwtService` (+ `JwtPayload`, `RefreshTokenPayload`) | `jwt.service.interface.ts` | `JwtService` (jsonwebtoken) |
| `IOAuthService` | `oauth.service.interface.ts` | `GoogleOAuthService` (google-auth-library) |
| `IEventPublisher` | `event-publisher.interface.ts` | `HttpEventPublisher` |
| `ISessionRevocationPublisher` | `session-revocation-publisher.ts` | `RedisSessionRevocationPublisher` |
| `SessionContext { ipAddress?, userAgent? }` (value type, not a port) | `session-context.ts` | built by the routes from the request |

Service specs replace adapters with fakes that implement the port (`FakeCache implements ICacheService` in `apps/auth_microservice/src/services/auth.service.spec.ts`).

Gotcha: `http-event-publisher.ts` imports its port as `'src/domain/interfaces/event-publisher.interface'` (non-relative). Prefer relative imports in new files, and keep that path resolution in mind when moving files.

### 4.6 Sessions, Tokens and Revocation

Key layout is shared with core through `RedisKeys` (`packages/shared/src/redis/redis-keys.ts`):

| Key | Written by | Meaning |
|---|---|---|
| `refresh_tokens:{jti}` | auth | refresh session JSON `{ userId, sid, ipAddress, userAgent, expiresAt }`, TTL = refresh lifetime |
| `blacklist:refresh:{jti}` | auth | rotated or revoked refresh token |
| `blacklist:access:{jti}` | auth (read by core) | revoked access token, TTL = time left |
| `auth:session-revoked` (channel) | auth (consumed by core) | `SessionRevokedEvent` JSON |

- Login and Google login create a session id `sid` (`randomUUID()`); access and refresh tokens both carry it, along with a `jti`.
- `POST /auth/refresh` checks the refresh blacklist and the `refresh_tokens:{jti}` record, blacklists the old refresh token (rotation) and issues a new pair with the **same** `sid`.
- `POST /auth/logout` deletes the session, blacklists the refresh token and (if given) the access token, and only then publishes `SessionRevokedEvent` (`sid` from the refresh token, else the access token). A publish failure is logged and does not fail logout. Core's reaction is in §3.10.

### 4.7 The Internal Listener

`createInternalApp(dataSource, logger)` serves `/internal` on its own listener, `AUTH_INTERNAL_HOST`:`AUTH_INTERNAL_PORT` (default `127.0.0.1:3012`); the public app never mounts `/internal`. It has no CORS and no Swagger.

```typescript
// apps/auth_microservice/src/app.ts
app.use(
  '/internal',
  createInternalTokenMiddleware(logger), // X-Internal-Token vs INTERNAL_API_TOKEN, timing-safe → 401
  createInternalRouter(new AuthUserRepository(dataSource)),
);
```

`GET /internal/users/:id/contact` returns `{ userId, email }`, or 404 (a non-UUID id short-circuits without a query). The notifications service calls it through `AUTH_INTERNAL_URL` to address emails. `INTERNAL_API_TOKEN` is required (32+ characters) and must match on both sides. In containers set `AUTH_INTERNAL_HOST=0.0.0.0` and never publish port 3012.

### 4.8 NestJS vs. Express Mapping

| Concern | NestJS (core, notifications) | Express (auth) |
|---|---|---|
| Entry point | `main.ts` → `NestFactory.create(AppModule)` | `main.ts` → `createApp(...)` + `createInternalApp(...)` |
| Wiring | `@Module({ imports, controllers, providers })` | `new` in `createApp()` |
| Port binding | `{ provide: TOKEN, useClass/useExisting }` + `@Inject(TOKEN)` | constructor argument typed as the interface |
| Controllers | `@Controller` + route decorators | router factories |
| Validation | global `ValidationPipe` (`whitelist`, `transform`) | per-route `validateBody(Dto)` |
| Auth | `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` | `requireAuth(authService)` + `req.user` |
| Error mapping | `DomainExceptionFilter` | `errorHandler` (table in §3.2 Layer 3) |
| Config | `AppConfigService` over `@nestjs/config` | `env` from `config/env.ts` |
| Shutdown | `enableShutdownHooks()` + lifecycle hooks | `SIGINT`/`SIGTERM` handlers in `main.ts` |
| Swagger | `@nestjs/swagger` decorators | `swagger-jsdoc` over `@openapi` comments |

---

## 5. `notifications_consumer_microservice`

A NestJS service with its own database (`innogram_notifications`) and port (`NOTIFICATIONS_PORT`, 3003). It owns notifications and email preferences, consumes core's events and sends email over SMTP (Mailpit locally).

```
apps/notifications_consumer_microservice/src/
├── config/              # global AppConfigModule / AppConfigService (port, postgres, rabbitmq, redis, jwtSecret, internalApiToken, authInternalUrl, clientUrl, smtp)
├── common/
│   ├── auth/            # JwtAuthGuard, CurrentUser, access-token verifier (same AccessTokenVerifier)
│   ├── messaging/       # MessagingModule (EVENT_BUS, CONSUMER_REGISTRY), amqp-topology.ts, retry policy, consumer host
│   └── redis/
└── modules/
    ├── notifications/   # domain/ (entities, ports, errors), application/ (handlers, email worker, purge scheduler), infrastructure/ (repositories, mail, auth directory)
    └── preferences/     # domain/, infrastructure/, controller + service
```

Modules split into `domain/` (entities, ports with `Symbol` tokens, errors), `application/` (message handlers and workers) and `infrastructure/` (TypeORM repositories, `NodemailerAdapter` behind `MAILER`, `AuthDirectoryAdapter` behind `RECIPIENT_DIRECTORY`). The REST surface is `GET /notifications`, `GET /notifications/unseen-count`, `POST /notifications/seen`, `GET|PUT /notifications/preferences`, all scoped to `user.sub`, with Swagger at `/api`. `main.ts` registers the same `ValidationPipe` and `DomainExceptionFilter` as core, and CORS from `AppConfigService.clientUrl`.

**Queues** (`apps/notifications_consumer_microservice/src/common/messaging/amqp-topology.ts`):

| Queue | Bindings | Retry | Dead letter |
|---|---|---|---|
| `notifications.events` | `social.#`, `chat.message.alerted` | `.retry` (10 s), 5 attempts | `.dlq` |
| `notifications.email` | email jobs | `.retry` (30 s), 3 attempts | none (dropped) |

A failed message is re-published to its retry queue with an incremented `x-attempts` and then acked. Invalid payloads, unknown types and `PoisonMessageError` skip retries.

**Handlers.** `SocialEventHandler` stores a notification (idempotent on the envelope's `eventId` through processed-event records and unique keys), publishes `notification.created` after commit and enqueues an email job when the recipient's preferences allow it. `MessageAlertHandler` stores no notification and only enqueues an email linking to `/messages/{chatId}`. `EmailWorker` sends through `MAILER`, with `email_deliveries` as the source of truth for attempts; recipient addresses come from auth's internal endpoint, cached in `recipient_contacts`. `POST /notifications/seen` publishes `notification.seen`. Both `notification.*` events reach browsers through core's relay (§3.11).

---

## 6. Request Lifecycle — `core_microservice`

Tracing `PATCH /chats/:chatId/messages/:messageId` (edit own message):

1. **HTTP entry.** Helmet, cookie-parser and CORS run, then Nest routes to `MessagesController.edit`.
2. **Guard.** The class-level `@UseGuards(JwtAuthGuard)` verifies the Bearer token through `AccessTokenVerifier`: missing/invalid/revoked → 401, Redis down → 503. On success `request.user = { sub, email, jti, sid?, exp }`.
3. **Pipes.** `ParseUUIDPipe` rejects malformed ids (400). The global `ValidationPipe` turns the body into `EditMessageDto`, strips undecorated fields and rejects invalid ones (400).
4. **`@CurrentUser('sub')`** hands the caller's auth user id to the controller, which calls `messagesService.edit(userId, chatId, messageId, dto)`.
5. **Service.** Opens `runInTransaction`; inside it locks the chat (`findByIdForUpdate`), checks membership through `chat.assertCanPost(me)` (non-member → `ChatNotFoundError` → 404), loads the message visible to the caller (`MessageNotFoundError` → 404), and allocates a `changeSeq`.
6. **Entity.** `message.edit(me, content, changeSeq)` enforces the rules: system messages are immutable (400), only the author may edit (`NotMessageAuthorError` → 403), deleted messages can't be edited (400), length and emptiness limits (400).
7. **Repository.** `messages.update(found, tx)` issues a narrow `UPDATE`; the transaction commits.
8. **Response and emit.** The service maps the entity with the chats mapper (presigning attachment URLs), emits `message:updated` to `chat:{chatId}` through `CHAT_REALTIME_PORT` (post-commit, failures logged), and returns the DTO; the controller sends 200.
9. **On error.** A `DomainError` anywhere in steps 5–7 rolls the transaction back and `DomainExceptionFilter` answers with the table in §3.2 Layer 3; nothing is emitted.

```
Client ─▶ helmet/CORS ─▶ JwtAuthGuard ─▶ ParseUUIDPipe/ValidationPipe ─▶ Controller
      ─▶ Service (tx: lock, load, allocate) ─▶ Entity rule ─▶ Repository (UPDATE) ─▶ commit
      ─▶ response DTO ─▶ emit message:updated ─▶ 200
   (DomainError ─▶ rollback ─▶ DomainExceptionFilter ─▶ 4xx/5xx JSON)
```

---

## 7. Auth → Core: User Creation

Registration in auth is followed by a fire-and-forget HTTP call to core; there is no broker on this path.

**Auth side.** `UsersService` builds a `UserCreatedEvent(authUserId, email, handle, timestamp)` (handle = email local part) and calls `IEventPublisher.publishUserCreatedEvent`. The adapter does not await:

```typescript
// apps/auth_microservice/src/infrastructure/events/http-event-publisher.ts (excerpt)
const url = `${coreUrl}/internal/events/user-created`; // coreUrl = CORE_SERVICE_URL
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  .then((res) => { if (!res.ok) this.logger.warn(`Failed to publish event to Core. Status: ${res.status}`); })
  .catch((err) => this.logger.error('Network error while publishing event to Core', { error: err }));
```

**Core side.** `InternalEventsModule` imports `ProfilesModule`; its controller is a routing layer with no business logic:

```typescript
// apps/core_microservice/src/modules/internal-events/internal-events.controller.ts
@ApiExcludeController()
@Controller('internal/events')
export class InternalEventsController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post('user-created')
  @HttpCode(HttpStatus.OK)
  async handleUserCreated(@Body() event: UserCreatedEvent): Promise<void> {
    await this.profilesService.createProfile(event.authUserId, event.handle);
  }
}
```

`UserCreatedEvent` (`packages/shared/src/events/user-created.event.ts`) carries `class-validator` decorators; without them the global `ValidationPipe` would strip every field. `createProfile` is idempotent (an existing profile for the `authUserId` is returned) and retries a username collision with a random suffix. The route is excluded from Swagger and must stay internal (Docker network only, never exposed publicly).

**Lazy-init fallback.** Failures are logged, never retried, so a profile can be missing. `GET /profiles/me` calls `ProfilesService.getOrCreateProfileByAuthUserId(sub, email)` (`apps/core_microservice/src/modules/profiles/profiles.service.ts`), which creates the profile on first read when it doesn't exist. The client loads its own profile through that route (`getMyProfile` in `apps/client_app/src/lib/api/profile.ts`), which closes the gap.

---

## 8. Developer Cookbook: Adding a Feature Module (Bookmarks)

Example: users bookmark posts. `POST /bookmarks` (create), `GET /bookmarks` (mine), `DELETE /bookmarks/:id` (only the owner). Everything lives in `modules/bookmarks/`.

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
├── dto/{create-bookmark.dto.ts, bookmark-response.dto.ts}
├── infrastructure/repository/bookmark.repository.ts
└── __tests__/fakers/{index.ts, bookmark.faker.ts}
```

### Step 2: Contracts

Add `ICreateBookmarkRequest { postId: string }` and `IBookmarkResponse { id, postId, createdAt }` under a new `bookmarks/` area in `packages/contracts/src/`, re-export from its `index.ts` and from `packages/contracts/src/index.ts`, then `npm run build -w @repo/contracts`.

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
@Entity('bookmarks')
@Unique('UQ_bookmarks_userId_postId', ['userId', 'postId'])
export class Bookmark extends TypeormEntityBase implements BookmarkProps {
  @Index('IDX_bookmarks_userId')
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne('UserProfile')
  @JoinColumn({ name: 'userId', referencedColumnName: 'authUserId', foreignKeyConstraintName: 'FK_bookmarks_userId_authUserId' })
  user!: UserProfile; // import type

  @Column({ type: 'uuid' })
  postId!: string;

  @ManyToOne('Post', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId', foreignKeyConstraintName: 'FK_bookmarks_postId' })
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
import { AccessDeniedError, DomainError } from '@repo/shared';

export class NotBookmarkOwnerError extends AccessDeniedError {      // → 403
  constructor() { super('You can only remove your own bookmarks.'); }
}
export class PostNotBookmarkableError extends DomainError {         // → 400
  constructor(postId: string) { super(`Post ${postId} cannot be bookmarked.`); }
}
```

A missing bookmark comes from the base `findOneByIdOrThrow` (`EntityByIdNotFoundError` → 404); a duplicate from the unique constraint (`UniqueConstraintViolationError` → 409). Statuses follow the table in §3.2 Layer 3; no `HttpException` anywhere below the controller.

### Step 5: Port and token

```typescript
// domain/interfaces/bookmark-repository.port.ts
import type { RepositoryPort } from '@repo/shared';
import type { Bookmark } from '../entities/bookmark.entity';
import type { BookmarkProps } from './bookmark.props';

export interface IBookmarkRepository extends RepositoryPort<Bookmark, BookmarkProps> {
  findByUser(userId: string): Promise<Bookmark[]>;
}

export const BOOKMARK_REPOSITORY = Symbol.for('IBookmarkRepository');
```

### Step 6: DTOs

```typescript
// dto/create-bookmark.dto.ts
export class CreateBookmarkDto implements ICreateBookmarkRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  postId!: string;
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

  findByUser(userId: string): Promise<Bookmark[]> {
    return this.repository.find({ where: { userId }, order: { createdAt: 'DESC' } });
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
    @Inject(BOOKMARK_REPOSITORY) private readonly bookmarks: IBookmarkRepository,
    @Inject(POST_REPOSITORY) private readonly posts: IPostRepository,
  ) {}

  async create(userId: string, dto: CreateBookmarkDto): Promise<Bookmark> {
    const post = await this.posts.findById(dto.postId);
    if (!post) throw new EntityByIdNotFoundError('Post', dto.postId);
    // A visibility rule would be a Post method (cf. Post.assertLikeableBy).
    const saved = await this.bookmarks.save(Bookmark.create({ userId, postId: post.id }));
    this.logger.debug('Bookmark created', { props: { bookmarkId: saved.id } });
    return saved;
  }

  listMine(userId: string): Promise<Bookmark[]> {
    return this.bookmarks.findByUser(userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    const bookmark = await this.bookmarks.findOneByIdOrThrow(id); // 404
    bookmark.assertOwnedBy(userId);                               // 403 for anyone else
    await this.bookmarks.delete(bookmark);
    this.logger.debug('Bookmark removed', { props: { bookmarkId: id } });
  }
}
```

If creating a bookmark should notify someone, write the outbox row in the same transaction: add `runInTransaction` and `save(e, tx?)` to the port (§3.5) and call `this.outbox.add(routingKey, payload, tx)` with `OUTBOX_PORT`.

### Step 9: Controller (guarded, `user.sub` only)

```typescript
// bookmarks.controller.ts
@ApiTags('Bookmarks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookmarks')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Post()
  @ApiOperation({ summary: 'Bookmark a post' })
  async create(@CurrentUser('sub') userId: string, @Body() dto: CreateBookmarkDto): Promise<BookmarkResponseDto> {
    return new BookmarkResponseDto(await this.bookmarksService.create(userId, dto));
  }

  @Get()
  @ApiOperation({ summary: 'List my bookmarks' })
  async listMine(@CurrentUser('sub') userId: string): Promise<BookmarkResponseDto[]> {
    return (await this.bookmarksService.listMine(userId)).map((b) => new BookmarkResponseDto(b));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of my bookmarks' })
  remove(@CurrentUser('sub') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
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
    LoggerModule.forFeature('BookmarksService'),
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

Add `BookmarksModule` to the imports in `apps/core_microservice/src/app.module.ts` and, optionally, `.addTag('Bookmarks')` to the Swagger `DocumentBuilder` in `main.ts`.

### Step 11: Migration

`synchronize` is off; every schema change is a migration in `apps/core_microservice/src/migrations/`. The CLI uses `apps/core_microservice/data-source.ts` at the app root, which loads the root `.env` and globs `src/**/*.entity{.ts,.js}` (so the file must be named `*.entity.ts`):

```bash
cd apps/core_microservice
npm run migration:generate -- src/migrations/AddBookmarks
npm run migration:run      # migration:revert to undo
```

Check that the generated SQL contains only your table, and that the constraint names match the entity (`UQ_bookmarks_userId_postId`, `IDX_bookmarks_userId`, `FK_bookmarks_*`). A hand-written migration uses an epoch-ms prefix larger than the latest existing one and a full inverse `down()`.

### Step 12: Tests

- Entity spec without Nest: `expect(() => fakeBookmark({ userId: 'a' }).assertOwnedBy('b')).toThrow(NotBookmarkOwnerError)`.
- Service spec: `Test.createTestingModule` with `{ provide: BOOKMARK_REPOSITORY, useValue: fake }`, `{ provide: POST_REPOSITORY, useValue: fake }` and a `LoggerKey` fake; assert that `remove` by another user throws and never calls `delete`.
- Run `cd apps/core_microservice && npx jest bookmarks` and `npx tsc --noEmit -p apps/core_microservice/tsconfig.json` from the root.

### Key rules

1. Rules live on entities and throw `DomainError` subclasses; pick the base class by status (§3.2 Layer 3).
2. Ports are interfaces with `Symbol` tokens; modules bind them, services inject them by token, controllers inject services only.
3. Every mutating route is guarded, takes the user from `@CurrentUser('sub')`, and the service checks ownership before mutating.
4. Multi-row writes go through `runInTransaction`; broker events go through the outbox in that transaction; realtime emits happen after the commit.
5. Wire types in `@repo/contracts`, request DTOs `implements` them, responses are DTOs, never entities.
6. Schema changes are migrations with explicit constraint names.

---

## Appendix: Project-Wide Pattern Reference

### A.1 Modules in `core_microservice`

| Module | Ports and tokens (in `domain/interfaces/`) | Adapters | Notes |
|---|---|---|---|
| `profiles` | `UserProfileRepositoryKey`, `USER_DIRECTORY_PORT` | `UserProfileRepository`, `UserDirectoryAdapter` | reference layout; `ProfilesService` still injects the concrete repository |
| `posts` | `POST_REPOSITORY` | `PostRepository` | `getLikeStats`; ownership checked in the service |
| `comments` | `COMMENT_REPOSITORY` (`CommentTransaction`) | `CommentRepository` | outbox `social.post.commented` |
| `likes` | `POST_LIKE_REPOSITORY`, `COMMENT_LIKE_REPOSITORY` | `PostLikeRepository`, `CommentLikeRepository` | entities owned by posts/comments; outbox `social.*.liked` |
| `follows` | `FollowRepositoryKey` | `FollowRepository` | outbox `social.user.followed` |
| `assets` | `FileStoragePortKey` | `S3StorageAdapter`, `AssetRepository` (concrete) | public and private buckets, presigned GETs |
| `chats` | `CHAT_REPOSITORY`, `MESSAGE_REPOSITORY`, `ATTACHMENT_STORAGE_PORT`, `CHAT_REALTIME_PORT` | `ChatRepository`, `MessageRepository`, `AttachmentStorageAdapter`, `ChatsGateway` | three services (chats, messages, membership); `SessionRevocationListener` registered here |
| `internal-events` | — | — | `POST /internal/events/user-created` |
| `notifications-relay` | — | `NotificationsRelayConsumer` | `core.realtime-relay` → `emitToUser` |

`common/`: `auth/` (verifier provider, `CommonAuthModule`, `OptionalJwtAuthGuard`), `guards/jwt-auth.guard.ts`, `decorators/current-user.decorator.ts`, `redis/` (`RedisModule`, `SessionRevocationListener`), `messaging/` (§3.11), `typeorm/bigint-number.transformer.ts`.

### A.2 `auth_microservice` at a glance

| Layer | Contents |
|---|---|
| Composition | `main.ts`, `app.ts` (`createApp`, `createInternalApp`) |
| Routes | `/users` (`users.routes.ts`), `/auth` (`auth.routes.ts`), `/internal` (`internal.routes.ts`, internal listener only) |
| Middleware | `requireAuth`, `validateBody`, `errorHandler`, `createInternalTokenMiddleware` |
| Services | `UsersService`, `AuthService` |
| Ports / adapters | table in §4.5 |
| Entity | `AuthUser` (`domain/entities/auth-user.entity.ts`) |
| Migrations | `src/migrations/`, CLI via `apps/auth_microservice/data-source.ts` |

### A.3 Global Infrastructure in core `main.ts`

| Setting | Value |
|---|---|
| Logger | `new WinstonLogger('CoreSystem')` |
| `helmet()` | security headers |
| `cookieParser()` | cookie parsing |
| CORS | origin `CLIENT_URL` (default `http://localhost:3000`), `credentials: true`, methods GET/POST/PUT/PATCH/DELETE/OPTIONS, headers `Content-Type`, `Authorization`, `Accept` |
| Pipe | `ValidationPipe({ whitelist: true, transform: true })` |
| Filter | `DomainExceptionFilter` |
| Swagger | `DocumentBuilder` → `/api` |
| Shutdown | `enableShutdownHooks()` |
| Port | `AppConfigService.port` (`CORE_PORT`, 3001) |

### A.4 TypeORM Entity Registration

- Runtime: each module's `TypeOrmModule.forFeature([...])`; the root `TypeOrmModule.forRootAsync` uses `autoLoadEntities: true` with `AppConfigService.postgres` (`synchronize: false`).
- CLI: `apps/core_microservice/data-source.ts` globs `src/**/*.entity{.ts,.js}` and `src/migrations/*{.ts,.js}`. The same layout holds for `apps/auth_microservice/data-source.ts` and `apps/notifications_consumer_microservice/data-source.ts`.

### A.5 DTOs in `@repo/shared`

| DTO | File | Used by |
|---|---|---|
| `CreateUserDto` | `packages/shared/src/dtos/auth/create-user.dto.ts` | auth `POST /users/register` |
| `LoginDto` | `packages/shared/src/dtos/auth/login.dto.ts` | auth `POST /auth/login` |
| `GoogleLoginDto` | `packages/shared/src/dtos/auth/google-login.dto.ts` | auth `POST /auth/google` |
| `RefreshTokenDto` | `packages/shared/src/dtos/auth/refresh-token.dto.ts` | auth `POST /auth/refresh`, `/auth/logout` |
| `UpdateProfileDto` | `packages/shared/src/dtos/core/update-profile.dto.ts` | core `PATCH /profiles/:id` |
| `CreateCommentDto` | `packages/shared/src/dtos/core/create-comment.dto.ts` | core comments |
| `UpdateCommentDto` | `packages/shared/src/dtos/core/update-comment.dto.ts` | core comments |

Every other request DTO is module-local (`modules/<module>/dto/`).

### A.6 Domain Errors in `@repo/shared`

| Class | File | Base |
|---|---|---|
| `DomainError` | `packages/shared/src/errors/domain.error.ts` | abstract |
| `EntityNotFoundError`, `EntityByIdNotFoundError`, `UniqueConstraintViolationError`, `DatabaseQueryError`, `UnauthorizedError` | `packages/shared/src/errors/database.errors.ts` | `DomainError` |
| `AccessDeniedError` | `packages/shared/src/errors/access-denied.error.ts` | `DomainError` |

HTTP statuses: the table in §3.2 Layer 3.

### A.7 Contracts in `@repo/contracts`

| Area | Exports |
|---|---|
| `common` | `IPaginatedResponse`, `IPaginationMeta`, `IProfileListResponse`, `PAGINATION_DEFAULTS` |
| `auth` | `ILoginRequest`, `IRegisterRequest`, `IGoogleLoginRequest`, `IAuthUserResponse`, `ILoginResponse`, `IRegisterResponse` |
| `profiles` | `ICreateProfileRequest`, `IUpdateProfileRequest`, `ISearchProfilesQuery`, `IProfileResponse` |
| `posts` | `PostStatus`, `IPostResponse`, `IPostAssetResponse`, `IFeedResponse` |
| `comments` | `ICommentResponse` |
| `likes` | `ILikeState` |
| `follows` | `ICreateFollowRequest`, `IFollowResponse` |
| `chats` | requests: `ICreateDirectChatRequest`, `ICreateGroupChatRequest`, `IListChatsQuery`, `IRenameGroupRequest`, `IAddMembersRequest`, `IListMessagesQuery`, `IMessageChangesQuery`, `ISendMessageRequest`, `IEditMessageRequest`, `IMarkReadRequest`; responses: `IMessage`, `IMessageResponse`, `IChatUser`, `IChatParticipant`, `IAttachment`, `IConversationSummary`, `IConversationDetail`, `ICursorPage`, `IReadState`, `IUploadedAttachment`, `IAttachmentUrl`, `ChatType`, `ParticipantRole`, `SystemEventType`; constants `MESSAGE_MAX_ATTACHMENTS`, `ATTACHMENT_MAX_BYTES` |
| `notifications` | `IListNotificationsQuery`, `IMarkSeenRequest`, `NotificationKind`, `INotification`, `INotificationPreferences`, `INotificationsPage`, `IUnseenCount` |
| `realtime` | `REALTIME_NAMESPACE`, `ServerToClientEvents` (`message:new`, `message:updated`, `message:deleted`, `chat:upsert`, `chat:removed`, `chat:read`, `chat:alert`, `typing`, `notification:new`, `notifications:seen`, `session:expired`), `ClientToServerEvents` (`chat:view`, `typing:start`, `typing:stop`, `auth:renew`), `IRealtimeAckError` |

---

*This guide reflects the architecture as of 2026-10-14. If you find discrepancies between the guide and the code, the code is authoritative: update the guide.*
