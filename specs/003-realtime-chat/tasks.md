---

description: "Task list for Real-time Chat, Messaging & Notifications (INO-6)"
---

# Tasks: Real-time Chat, Messaging & Notifications

**Input**: Design documents from `/specs/003-realtime-chat/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/README.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The plan's testing strategy (research §17) and the constitution ("write specs alongside the code they verify") require unit specs next to the domain code, and `quickstart.md` §3 expects a core e2e suite. Unit specs (`*.spec.ts`, `rootDir: src`) run in CI for core. E2E specs (`test/*.e2e-spec.ts`) run locally against `npm run docker:up`.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated on its own, per the spec's "Independent Test".

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story the task belongs to (US1–US6)
- Paths are relative to the repo root

## Path Conventions

| Short name | Path |
|------------|------|
| core | `apps/core_microservice/src/` (e2e: `apps/core_microservice/test/`) |
| auth | `apps/auth_microservice/src/` |
| notif | `apps/notifications_consumer_microservice/src/` |
| client | `apps/client_app/src/` |
| contracts | `packages/contracts/src/` |
| shared | `packages/shared/src/` |

Task descriptions always spell out the full path. The table is only a reading aid.

## Ground rules for every task

- Read `DDD_ARCHITECTURE_GUIDE.md` before touching core. `modules/profiles` is the reference layout.
- Business rules live on entity methods and throw `DomainError` subclasses. Services orchestrate, controllers only map HTTP. No `HttpException` in domain code.
- Ports are interfaces in `domain/interfaces/`, bound to adapters with `Symbol` DI tokens.
- Request DTOs `implements` the matching `@repo/contracts` interface and add `class-validator` decorators. The client imports `@repo/contracts` only, never `@repo/shared`.
- Schema changes are TypeORM migrations in `src/migrations/` (`synchronize: false`), generated or hand-written per app.
- After changing `packages/shared` or `packages/contracts`, run `npm run build -w @repo/shared -w @repo/contracts` before building or testing an app.
- Prettier: `singleQuote: true`, `trailingComma: "all"`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, environment and local infrastructure.

- [X] T001 Add `@nestjs/websockets@^11`, `@nestjs/platform-socket.io@^11`, `@aws-sdk/s3-request-presigner@^3`, `amqplib` and `amqp-connection-manager` to dependencies, and `@types/amqplib` and `socket.io-client@^4` (used by e2e tests) to devDependencies, in `apps/core_microservice/package.json`, then run `npm install` from the repo root
- [X] T002 [P] Add `amqplib`, `amqp-connection-manager`, `nodemailer`, `ioredis@^5`, `jsonwebtoken` (plus `@nestjs/config`, `class-validator`, `class-transformer` if not already listed) to dependencies, and `@types/amqplib`, `@types/nodemailer`, `@types/jsonwebtoken` to devDependencies, in `apps/notifications_consumer_microservice/package.json`
- [X] T003 [P] Add `socket.io-client@^4` to dependencies in `apps/client_app/package.json`
- [X] T004 [P] Add `jsonwebtoken` to dependencies and `@types/jsonwebtoken` to devDependencies in `packages/shared/package.json`
- [X] T005 [P] Add the new variables to `.env.example` with comments: `INTERNAL_API_TOKEN` (placeholder, "32+ random characters"), `AUTH_INTERNAL_PORT=3012`, `AUTH_INTERNAL_HOST=127.0.0.1` (comment: "`0.0.0.0` inside containers; never publish or proxy this port"), `AUTH_INTERNAL_URL=http://localhost:3012`, `RABBITMQ_URL=amqp://innogram:innogram_password@localhost:5672` (with credentials matching `RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS`), `S3_PRIVATE_BUCKET_NAME=innogram-private`, `S3_PUBLIC_ENDPOINT=` (optional, defaults to `S3_ENDPOINT`), `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`, `SMTP_FROM="Innogram <no-reply@innogram.local>"`
- [X] T006 [P] In `docker-compose.yml`: add a `mailpit` service (`axllent/mailpit`, ports `1025:1025` SMTP and `8025:8025` UI, on `innogram-network`), and extend the `minio-setup` entrypoint with `mc mb myminio/innogram-private || true` and **no** `mc anonymous set` for that bucket (research F3, §8)
- [X] T007 [P] Expose the notifications service URL to the client: add `NEXT_PUBLIC_NOTIFICATIONS_SERVICE_URL: process.env.NOTIFICATIONS_SERVICE_URL ?? ''` in `apps/client_app/next.config.ts`, add `notificationsServiceUrl` (default `http://localhost:3003`) to `apps/client_app/src/lib/config.ts`, and add a `notificationsRequest<T>()` helper next to `coreRequest`/`authRequest` in `apps/client_app/src/lib/api/client.ts`

**Checkpoint**: `npm install` succeeds; `npm run docker:up` starts Mailpit and creates both MinIO buckets.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared auth verification and errors, all wire contracts, session id and revocation in auth, the authenticated Socket.IO gateway skeleton, and the client's token refresh and realtime provider. Every story depends on these (FR-001 to FR-005).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Shared package (`@repo/shared`)

- [X] T008 [P] Create `AccessDeniedError extends DomainError` in `packages/shared/src/errors/access-denied.error.ts` and export it from `packages/shared/src/index.ts`
- [X] T009 Map `AccessDeniedError` (and subclasses) to **403** `Forbidden` in `packages/shared/src/filters/domain-exception.filter.ts`, checked before the existing "everything else → 400" default (research F11, §7)
- [X] T010 [P] Create `AccessTokenVerifier` in `packages/shared/src/auth/access-token.verifier.ts` exactly per contracts/auth-internal.md §4: `constructor(secret: string, isRevoked: (jti: string) => Promise<boolean>)`, `verify(token: string | undefined): Promise<VerifyResult>` where `VerifyResult = { ok: true; payload: { sub; email; jti; sid?; exp } } | { ok: false; reason: 'missing' | 'invalid' | 'revoked' | 'unavailable' }`. Missing token → `missing`; bad signature, expired, or no `jti` → `invalid`; `isRevoked` throws → `unavailable` (fail closed); `isRevoked` true → `revoked`. Export from `packages/shared/src/index.ts`
- [X] T011 [P] Add `sessionRevokedChannel: 'auth:session-revoked'` to `RedisKeys` in `packages/shared/src/redis/redis-keys.ts`, and update the `refreshSession` doc comment to `{ userId, sid, ipAddress, userAgent, expiresAt }`
- [X] T012 [P] Create `SessionRevokedEvent { userId: string; sid: string | null; jti: string | null; revokedAt: string }` (class with `class-validator` decorators, same style as `user-created.event.ts`) in `packages/shared/src/events/session-revoked.event.ts` and export it

### Wire contracts (`@repo/contracts`)

- [X] T013 [P] Rewrite `packages/contracts/src/chats/responses.ts` with every shape in contracts/chats-http.md "Shared shapes": `ChatType`, `ParticipantRole`, `IChatUser`, `IChatParticipant`, `IAttachment` (`kind: 'image' | 'video' | 'file'`), `SystemEventType`, `IMessage` (`seq`/`changeSeq` as `number`), `IConversationSummary`, `IConversationDetail`, `ICursorPage<T>`, plus `IReadState { chatId; lastReadSeq; unreadCount }`, `IUploadedAttachment { id; mimeType; size; originalName }`, `IAttachmentUrl { url; expiresAt }`. Keep the existing message response export only if something still imports it
- [X] T014 [P] Add to `packages/contracts/src/chats/requests.ts`: `ICreateDirectChatRequest`, `ICreateGroupChatRequest`, `IListChatsQuery`, `IRenameGroupRequest`, `IAddMembersRequest`, `IListMessagesQuery`, `IMessageChangesQuery`, `ISendMessageRequest`, `IEditMessageRequest`, `IMarkReadRequest` as defined in contracts/chats-http.md. Leave the old `ICreateMessageRequest` in place for now (removed in T048)
- [X] T015 [P] Create `packages/contracts/src/notifications/{requests,responses,index}.ts` per contracts/notifications-http.md: `NotificationKind`, `INotification`, `INotificationPreferences`, `IListNotificationsQuery { before?; limit? }`, `INotificationsPage { items; hasMore; unseenCount }`, `IUnseenCount { unseenCount }`, `IMarkSeenRequest { upTo? }`
- [X] T016 [P] Create `packages/contracts/src/likes/{responses,index}.ts` with `ILikeState { liked: boolean; likeCount: number }`
- [X] T017 Create `packages/contracts/src/realtime/{events,index}.ts` exporting `ServerToClientEvents` (11 events: `message:new`, `message:updated`, `message:deleted`, `chat:upsert`, `chat:removed`, `chat:read`, `chat:alert`, `typing`, `notification:new`, `notifications:seen`, `session:expired`) and `ClientToServerEvents` (4 events: `chat:view`, `typing:start`, `typing:stop`, `auth:renew`, with ack callback signatures `{ ok: true; ... } | { ok: false; error: { code; message } }`), payloads exactly as in contracts/realtime-socket.md, plus `REALTIME_NAMESPACE = '/realtime'` (depends on T013, T015)
- [X] T018 Export the new `notifications`, `likes` and `realtime` modules from `packages/contracts/src/index.ts`, then run `npm run build -w @repo/shared -w @repo/contracts` and fix any type errors (depends on T008–T017)

### Auth: stable session id and revocation publishing (research §2, contracts/auth-internal.md §1–2)

- [X] T019 [P] Add optional `sid?: string` to the access and refresh token payload types in `apps/auth_microservice/src/domain/interfaces/jwt.service.interface.ts` and sign it into both tokens in `apps/auth_microservice/src/infrastructure/jwt/jwt.service.ts`
- [X] T020 [P] Create the port `ISessionRevocationPublisher { publish(event: SessionRevokedEvent): Promise<void> }` in `apps/auth_microservice/src/domain/interfaces/session-revocation-publisher.ts`
- [X] T021 [P] Create `RedisSessionRevocationPublisher` in `apps/auth_microservice/src/infrastructure/events/redis-session-revocation.publisher.ts`: `PUBLISH RedisKeys.sessionRevokedChannel JSON.stringify(event)`; log and swallow Redis errors (logout must still succeed)
- [X] T022 Update `apps/auth_microservice/src/services/auth.service.ts`: `login` and `loginWithGoogle` generate `sid = randomUUID()` and store it in the refresh-session record `refresh_tokens:{jti}` → `{ userId, sid, ipAddress, userAgent, expiresAt }`; `refresh` copies `sid` from the old record into the new tokens and the new record (a record without `sid` stays without one); `logout` publishes `{ userId, sid: sid ?? null, jti: accessJti ?? null, revokedAt }` through the injected `ISessionRevocationPublisher` **after** blacklisting the tokens (depends on T019, T020)
- [X] T023 Wire `RedisSessionRevocationPublisher` into `AuthService` in `createApp()` in `apps/auth_microservice/src/app.ts` (depends on T021, T022)
- [X] T024 Extend `apps/auth_microservice/src/services/auth.service.spec.ts`: login puts the same `sid` in both tokens and the session record; refresh keeps `sid`; logout blacklists and then publishes once with the right `sid`/`jti`; a publisher failure doesn't fail logout (depends on T022)

### Core: shared verifier, guard and socket gateway skeleton

- [X] T025 [P] Unit spec for `AccessTokenVerifier` in `apps/core_microservice/src/common/auth/access-token.verifier.spec.ts` (shared has no Jest; CI runs core): valid token → `ok` with `sid`; missing → `missing`; tampered or expired → `invalid`; no `jti` → `invalid`; blacklisted → `revoked`; `isRevoked` throws → `unavailable` (depends on T010, T018)
- [X] T026 Create `apps/core_microservice/src/common/auth/access-token-verifier.provider.ts`: a provider under token `ACCESS_TOKEN_VERIFIER` that builds `AccessTokenVerifier` from `JWT_ACCESS_SECRET || JWT_SECRET` and an `isRevoked` callback doing `redis.exists(RedisKeys.accessBlacklist(jti)) === 1` with the `REDIS_CLIENT`; export it from a `CommonAuthModule` in `apps/core_microservice/src/common/auth/common-auth.module.ts` (depends on T018)
- [X] T027 Refactor `apps/core_microservice/src/common/guards/jwt-auth.guard.ts` to delegate to `ACCESS_TOKEN_VERIFIER`, mapping `missing`/`invalid`/`revoked` → 401 and `unavailable` → 503 with the current messages, and setting `request.user` as today (now including `sid`). Behaviour must not change: `apps/core_microservice/src/common/guards/jwt-auth.guard.spec.ts` must pass after only updating its test module providers (depends on T026)
- [X] T028 Create the chat realtime port `IChatRealtimePort` with token `CHAT_REALTIME_PORT` in `apps/core_microservice/src/modules/chats/domain/interfaces/chat-realtime.port.ts`, with methods `emitToChat(chatId, event, payload)`, `emitToUser(userId, event, payload)`, `joinUserToChat(userId, chatId)`, `removeUserFromChat(userId, chatId)`, `isUserViewingChat(userId, chatId): boolean`, typed against `ServerToClientEvents` (depends on T018)
- [X] T029 Create the Socket.IO handshake middleware in `apps/core_microservice/src/modules/chats/infrastructure/realtime/socket-auth.middleware.ts`: read `socket.handshake.auth.token`, run `AccessTokenVerifier`, reject with `new Error('unauthorized')` for `missing`/`invalid`/`revoked` and `new Error('unavailable')` for `unavailable`, and on success set `socket.data = { userId: sub, sid, jti, exp, viewingChatId: null }`. Never read the token from the query string (depends on T026)
- [X] T030 Create the WS exception filter in `apps/core_microservice/src/modules/chats/infrastructure/realtime/ws-domain-exception.filter.ts` that turns a `DomainError` thrown by a socket handler into an ack `{ ok: false, error: { code: error.constructor.name, message } }` and logs anything else
- [X] T031 Create `ChatsGateway` in `apps/core_microservice/src/modules/chats/infrastructure/realtime/chats.gateway.ts`: `@WebSocketGateway({ namespace: '/realtime', cors: { origin: CLIENT_URL, credentials: true } })`, server typed `Server<ClientToServerEvents, ServerToClientEvents>`; registers T029 in `afterInit`; on connection joins `user:{userId}` and starts a timer to the token's `exp` that emits `session:expired { reason: 'expired' }` and disconnects; clears timers on disconnect; implements `IChatRealtimePort` (`emitToChat` → `chat:{id}` room, `emitToUser` → `user:{id}` room, `joinUserToChat`/`removeUserFromChat` via `server.in('user:{id}').socketsJoin/socketsLeave('chat:{chatId}')`, `isUserViewingChat` scans the user's sockets for `data.viewingChatId === chatId`); handles `auth:renew { token }` per contracts/realtime-socket.md (same `sub`, same `sid` when present, swap `jti`/`sid`/`exp`, reset timer, ack `{ ok: true, expiresAt }`, disconnect on failure). Every client-to-server handler first re-checks the blacklist for `socket.data.jti`. Logs `Realtime gateway listening on /realtime` (depends on T028, T029, T030)
- [X] T032 Create `SessionRevocationListener` in `apps/core_microservice/src/common/redis/session-revocation.listener.ts`: a dedicated ioredis subscriber connection (`redis.duplicate()`), subscribes to `RedisKeys.sessionRevokedChannel` on module init (logs `Subscribed to auth:session-revoked`), validates the JSON as `SessionRevokedEvent`, then for sockets in `user:{userId}` whose `data.sid === sid` (or `data.jti === jti` when `sid` is null) emits `session:expired { reason: 'revoked' }` and disconnects them; unsubscribes and quits on module destroy (depends on T012, T031)
- [X] T033 Register `CommonAuthModule`, the gateway (provided as `CHAT_REALTIME_PORT` via `useExisting: ChatsGateway`) and `SessionRevocationListener` in `apps/core_microservice/src/modules/chats/chats.module.ts` and `apps/core_microservice/src/app.module.ts`; export `CHAT_REALTIME_PORT` from `ChatsModule` (depends on T027, T031, T032)
- [X] T034 [P] Create `IUserDirectoryPort` with token `USER_DIRECTORY_PORT` in `apps/core_microservice/src/modules/profiles/domain/interfaces/user-directory.port.ts` (`getUsers(userIds): Promise<Map<string, IChatUser>>`, `assertUsersExist(userIds)` throwing `UserNotFoundError`), add `UserNotFoundError extends EntityNotFoundError` to `apps/core_microservice/src/modules/profiles/domain/errors/user-profile.errors.ts`, implement `UserDirectoryAdapter` over the profile repository (lookup by `authUserId`; `avatarUrl` null when unset) in `apps/core_microservice/src/modules/profiles/infrastructure/user-directory.adapter.ts`, and provide and export it from `apps/core_microservice/src/modules/profiles/profiles.module.ts`

### Client: token refresh and realtime provider (research §15)

- [X] T035 [P] Create `apps/client_app/src/lib/auth/refresh.ts`: `refreshTokens()` calls `POST /auth/refresh` with the stored refresh token through a single shared in-flight promise, stores the new pair, and notifies subscribers; on failure clears tokens and signs out. Update `apiRequest` in `apps/client_app/src/lib/api/client.ts` to retry once after a 401 when a token was sent, using the refreshed token, and to accept a `FormData` body (no JSON `Content-Type`) for uploads. Expose the current access token getter and a subscribe hook from `apps/client_app/src/lib/auth/auth-context.tsx` (depends on T007)
- [X] T036 Create `apps/client_app/src/lib/realtime/realtime-provider.tsx`: a `RealtimeProvider` that, once signed in, opens `io(`${config.coreServiceUrl}/realtime`, { auth: (cb) => cb({ token: currentAccessToken }), transports: ['websocket', 'polling'] })` typed `Socket<ServerToClientEvents, ClientToServerEvents>`; on `connect_error` `unauthorized` refreshes once and reconnects, otherwise signs out; on `session:expired` refreshes and reconnects for `expired`, signs out for `revoked`; after every token refresh emits `auth:renew`; disconnects on sign-out. Create `apps/client_app/src/lib/realtime/use-socket-event.tsx` with `useSocket()` and `useSocketEvent(event, handler)`. Mount the provider inside `QueryProvider` in `apps/client_app/src/app/layout.tsx` (depends on T003, T018, T035)

**Checkpoint**: Shared and contracts build. Auth tokens carry `sid`. Core starts, `/realtime` accepts a valid token and refuses missing or garbage tokens with `connect_error: unauthorized`. Logging out in one tab disconnects another tab's socket with `session:expired { reason: 'revoked' }`. Existing guard spec passes.

---

## Phase 3: User Story 1 - Private conversation with live delivery (Priority: P1) 🎯 MVP

**Goal**: Two users exchange one-on-one text messages, delivered live, with ordered history, de-duplicated retries, reconnect catch-up, read state, and refusal for outsiders.

**Independent Test**: quickstart.md §4 "US1". A starts a conversation with B and sends a message; B sees it live; B replies; reloading shows the full ordered history; starting again returns the same chat (200); C gets 404; a token-less handshake gets `connect_error: unauthorized`.

### Tests for User Story 1

- [ ] T037 [P] [US1] Unit spec `apps/core_microservice/src/modules/chats/domain/entities/chat.entity.spec.ts`: `Chat.createDirect(a, a)` throws `CannotChatWithSelfError`; `createDirect(a, b)` and `createDirect(b, a)` produce the same `directKey` `"{minUserId}:{maxUserId}"`, type `DIRECT`, null title, two `MEMBER` participants with `joinedSeq` 0; `assertCanRead`/`assertCanPost` throw `ChatNotFoundError` for a non-participant and for a participant with `leftAt` set
- [ ] T038 [P] [US1] Unit spec `apps/core_microservice/src/modules/chats/domain/entities/chat-participant.entity.spec.ts`: `markRead(seq, chatLastSeq)` sets `lastReadSeq = max(lastReadSeq, min(seq, chatLastSeq))`, never moves backwards, never ends below `joinedSeq`
- [ ] T039 [P] [US1] Unit spec `apps/core_microservice/src/modules/chats/domain/entities/message.entity.spec.ts` (create rules): content is trimmed; whitespace-only content with no attachments → `EmptyMessageError`; 2,001 chars → `MessageTooLongError`; 2,000 chars accepted; 11 attachment ids → `TooManyAttachmentsError`; attachments-only accepted; `changeSeq === seq` on creation; `kind` `USER`; `isVisibleTo` is true only when `leftAt == null && seq > joinedSeq`
- [ ] T040 [P] [US1] Unit spec `apps/core_microservice/src/modules/chats/messages.service.spec.ts` with mocked ports: send by a non-participant → `ChatNotFoundError`; first send returns `{ message, created: true }` and emits `message:new` to `chat:{id}` only after the transaction resolves; a repeated `clientMessageId` returns the original message with `created: false` and emits nothing; a unique-violation race on `(chatId, authorId, clientMessageId)` re-reads and returns the original; the sender's `lastReadSeq` moves to the new `seq`
- [ ] T041 [P] [US1] Replace `apps/core_microservice/src/modules/chats/chats.service.spec.ts` with a spec for the rebuilt `ChatsService`: `createDirect` with an existing pair returns `{ created: false }` and the same chat; unknown target → `UserNotFoundError`; a new pair → `{ created: true }`, both users joined to `chat:{id}` and sent `chat:upsert`; `markRead` emits `chat:read` to `user:{me}`
- [ ] T042 [P] [US1] Replace `apps/core_microservice/src/modules/chats/chats.controller.spec.ts` with specs for the new `ChatsController` and `MessagesController`: `POST /chats/direct` returns 201 for created and 200 for existing; `POST /chats/:chatId/messages` returns 201 or 200 based on `created`
- [ ] T043 [P] [US1] E2E spec `apps/core_microservice/test/realtime.e2e-spec.ts` (supertest + `socket.io-client`, two signed-in users plus outsider C): handshake with no token and with a garbage token → `connect_error` `unauthorized`; A creates a direct chat and sends, B's socket receives `message:new` with matching `seq`; C gets 404 on `GET /chats/:id`, `GET /chats/:id/messages` and `POST /chats/:id/messages`, and C's socket receives nothing; a repeated `clientMessageId` → 200 with the same id and B receives one event; B disconnects, A sends 3 messages, B reconnects and `GET /chats/:id/messages/changes?afterChangeSeq=<cursor>` returns exactly those 3 in `changeSeq` order (SC-003); logout via auth disconnects A's socket with `session:expired { reason: 'revoked' }`

### Implementation for User Story 1

- [ ] T044 [US1] Create migration `apps/core_microservice/src/migrations/<timestamp>-ExtendChatDomainForRealtime.ts` covering all chat columns in data-model.md (used by US1–US5): `chats` + `"directKey" varchar(73) NULL UNIQUE`, `"createdById" uuid`, `"lastSeq" bigint NOT NULL DEFAULT 0`, `"lastActivityAt" timestamptz` (backfill from `"updatedAt"`, then NOT NULL DEFAULT now()), index `("lastActivityAt" DESC)`; `chat_participants` + `"joinedSeq" bigint NOT NULL DEFAULT 0`, `"leftAt" timestamptz NULL`, `"lastReadSeq" bigint NOT NULL DEFAULT 0`, `"updatedAt" timestamp NOT NULL DEFAULT now()`, partial index `("userId") WHERE "leftAt" IS NULL`, change `"joinedAt"` to `timestamptz` with no create-date default semantics; `messages` + `"kind" varchar(10) NOT NULL DEFAULT 'USER'`, `"seq" bigint`, `"changeSeq" bigint`, `"clientMessageId" uuid NULL`, `"editedAt" timestamptz NULL`, `"systemEvent" jsonb NULL`, make `"content"` nullable, backfill `seq`/`changeSeq` with `ROW_NUMBER() OVER (PARTITION BY "chatId" ORDER BY "createdAt", id)` and set `chats."lastSeq"` to the per-chat max, then `seq`/`changeSeq` NOT NULL, unique `("chatId","seq")`, index `("chatId","changeSeq")`, unique `("chatId","authorId","clientMessageId")`; `message_assets` unique index on `"assetId"` alone. Write a full `down()`
- [ ] T045 [P] [US1] Create `apps/core_microservice/src/modules/chats/domain/errors/chat.errors.ts` with `ChatNotFoundError extends EntityNotFoundError` (404, also used for non-participants so existence isn't revealed), `CannotChatWithSelfError`, `EmptyMessageError`, `MessageTooLongError`, `TooManyAttachmentsError` (all `DomainError`, 400)
- [ ] T046 [US1] Rebuild `apps/core_microservice/src/modules/chats/domain/entities/chat.entity.ts` on `TypeormEntityBase`: `type` varchar(20) `ChatType` enum `DIRECT | GROUP`; `title` varchar(100) null ("Always null for `DIRECT`"); `directKey` varchar(73) null unique; `createdById` uuid; `lastSeq` bigint default 0 (bigint transformer to `number`); `lastActivityAt` timestamptz; `participants` one-to-many. Methods: `static createDirect(a, b)` ("`a ≠ b`. Builds `directKey`. Both users become `MEMBER` participants", else `CannotChatWithSelfError`), `assertCanRead(userId)`/`assertCanPost(userId)` ("The user has an active participant row", else `ChatNotFoundError`), `activeParticipants()`, `participantOf(userId)` (depends on T045)
- [ ] T047 [P] [US1] Extend `apps/core_microservice/src/modules/chats/domain/entities/chat-participant.entity.ts`: `role` varchar(20) `ParticipantRole` enum `ADMIN | MEMBER`; `joinedAt` timestamptz as a plain `@Column` (not `CreateDateColumn`, "set again on re-join"); `joinedSeq` bigint default 0; `leftAt` timestamptz null ("Null means active"); `lastReadSeq` bigint default 0; `updatedAt`; methods `isActive()`, `markRead(seq, chatLastSeq)` ("Never moves backwards. Never below `joinedSeq`")
- [ ] T048 [US1] Rebuild `apps/core_microservice/src/modules/chats/domain/entities/message.entity.ts`: `kind` varchar(10) default `USER` (`USER | SYSTEM`); `content` text null ("1–2,000 chars when present"); `seq` bigint; `changeSeq` bigint; `clientMessageId` uuid null; `editedAt` timestamptz null; `systemEvent` jsonb null; `deletedAt` (soft delete, still returned as tombstones). `static create({ chatId, authorId, content?, attachmentIds?, clientMessageId, seq })`: "Content is trimmed. It is either absent or 1–2,000 chars. Attachments are 0–10. **At least one** of content or attachments is present", else `EmptyMessageError`/`MessageTooLongError`/`TooManyAttachmentsError`; `changeSeq = seq`. `isVisibleTo(participant)`. Remove `ICreateMessageRequest` from `packages/contracts/src/chats/requests.ts` and rebuild contracts (depends on T045)
- [ ] T049 [P] [US1] Rename `apps/core_microservice/src/modules/chats/domain/entities/message-asset.entity.ts` to `message-attachment.entity.ts` (class `MessageAttachment`, table still `message_assets`): `messageId` FK cascade, `assetId` FK unique, `displayOrder` int ("The sender's order, starting at 0"), `createdAt`; update every import
- [ ] T050 [P] [US1] Create ports `apps/core_microservice/src/modules/chats/domain/interfaces/chat-repository.port.ts` (`CHAT_REPOSITORY`: `findById`, `findDirectByKey`, `findActiveParticipation(chatId, userId)`, `listForUser(userId, { before?, limit })` returning summaries with `unreadCount`, last message, `memberCount`, counterpart, `myRole`, `findActiveChatIdsForUser(userId)`, `save`, `runInTransaction(work)`) and `message-repository.port.ts` (`MESSAGE_REPOSITORY`: `allocateSeq(chatId, tx)`, `insert(message, tx)`, `findByClientMessageId(chatId, authorId, clientMessageId)`, `findById`, `pageHistory(chatId, joinedSeq, { beforeSeq?, limit })`, `pageChanges(chatId, joinedSeq, { afterChangeSeq, limit })`, `findLatestVisible(chatId, joinedSeq)`)
- [ ] T051 [US1] Implement `ChatRepository` in `apps/core_microservice/src/modules/chats/infrastructure/repository/chat.repository.ts` against the port: `listForUser` filters `leftAt IS NULL`, orders by `lastActivityAt DESC` with the `before` cursor and `limit` (1–50, default 20), computes `unreadCount = COUNT(messages m WHERE m.chatId = p.chatId AND m.seq > GREATEST(p.lastReadSeq, p.joinedSeq) AND m.kind = 'USER' AND m.authorId <> p.userId AND m.deletedAt IS NULL)`, and returns `lastChangeSeq = chat.lastSeq`; `runInTransaction` uses the TypeORM `DataSource` (depends on T046, T047, T050)
- [ ] T052 [US1] Implement `MessageRepository` in `apps/core_microservice/src/modules/chats/infrastructure/repository/message.repository.ts`: `allocateSeq` runs `UPDATE chats SET "lastSeq" = "lastSeq" + 1, "lastActivityAt" = now() WHERE id = $1 RETURNING "lastSeq"` inside the given transaction; `pageHistory` returns newest first, `seq > joinedSeq`, `seq < beforeSeq`, `withDeleted`, `limit` 1–100 default 50, `hasMore`; `pageChanges` returns `changeSeq > afterChangeSeq` and `seq > joinedSeq`, ordered `changeSeq ASC`, `withDeleted`, `limit` 1–500 default 200, `hasMore`; deleted rows come back as tombstones with null content and no attachments (depends on T048, T049, T050)
- [ ] T053 [P] [US1] Create DTOs in `apps/core_microservice/src/modules/chats/dto/`: `create-direct-chat.dto.ts` (`@IsUUID() userId`), `list-chats-query.dto.ts` (`@IsOptional() @IsISO8601() before`, `@IsInt() @Min(1) @Max(50)` limit default 20), `list-messages-query.dto.ts` (`beforeSeq` int ≥ 1 optional, limit 1–100 default 50), `message-changes-query.dto.ts` (`afterChangeSeq` int ≥ 0 required, limit 1–500 default 200), `send-message.dto.ts` (`@IsUUID() clientMessageId`, `@IsOptional() @IsString() @MaxLength(2000) content`, `@IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true }) attachmentIds`), `mark-read.dto.ts` (`@IsInt() @Min(0) seq`); all with `@Type(() => Number)` where needed and implementing the contracts interfaces. Delete `create-message.dto.ts`
- [ ] T054 [P] [US1] Create the response mapper `apps/core_microservice/src/modules/chats/dto/chat-response.mapper.ts` turning entities plus `IUserDirectoryPort` snapshots into `IMessage`, `IConversationSummary` and `IConversationDetail` (dates as ISO strings, `seq`/`changeSeq` as numbers, `counterpart` only for `DIRECT`, `participants` active only, `attachments: []` for now). Replace `message-response.dto.ts` with Swagger response classes implementing the contracts
- [ ] T055 [US1] Rebuild `apps/core_microservice/src/modules/chats/chats.service.ts` on ports only (remove `@InjectRepository`): `createDirect(me, userId)` asserts the user exists via `USER_DIRECTORY_PORT`, returns the existing chat for the `directKey` or creates one (catching a unique violation on `directKey` and re-reading), and after commit calls `joinUserToChat` for both users and emits `chat:upsert` to both; `list(me, query)`; `getDetail(me, chatId)` (`assertCanRead`); `markRead(me, chatId, seq)` updates `lastReadSeq` via `ChatParticipant.markRead` and emits `chat:read` (`IReadState`) to `user:{me}` (FR-030) (depends on T034, T051, T054)
- [ ] T056 [US1] Create `apps/core_microservice/src/modules/chats/messages.service.ts`: `send(me, chatId, dto)` returns the existing message when `findByClientMessageId` hits; otherwise in one transaction `assertCanPost`, `allocateSeq`, `Message.create`, insert, move the sender's `lastReadSeq` to the new `seq`; on a unique violation of `(chatId, authorId, clientMessageId)` re-read and return the original (`created: false`); after commit emit `message:new { message }` to `chat:{id}`. `history(me, chatId, query)` and `changes(me, chatId, query)` use the caller's `joinedSeq` (FR-017) (depends on T051, T052, T054)
- [ ] T057 [US1] Rewrite `apps/core_microservice/src/modules/chats/chats.controller.ts` (remove `POST /chats/messages`): `@UseGuards(JwtAuthGuard)` on all routes; `POST /chats/direct` sets status 201 or 200 from `created`; `GET /chats`; `GET /chats/:chatId` (`ParseUUIDPipe`); `POST /chats/:chatId/read`; Swagger decorators. Create `apps/core_microservice/src/modules/chats/messages.controller.ts` with `GET /chats/:chatId/messages`, `GET /chats/:chatId/messages/changes`, `POST /chats/:chatId/messages` (201 or 200 from `created`) (depends on T053, T055, T056)
- [ ] T058 [US1] On socket connection in `apps/core_microservice/src/modules/chats/infrastructure/realtime/chats.gateway.ts`, join `chat:{id}` for every id from `CHAT_REPOSITORY.findActiveChatIdsForUser(userId)` (FR-004) (depends on T051)
- [ ] T059 [US1] Wire `apps/core_microservice/src/modules/chats/chats.module.ts`: `TypeOrmModule.forFeature` for the four entities, `CHAT_REPOSITORY`/`MESSAGE_REPOSITORY` bound to the adapters, import `ProfilesModule` for `USER_DIRECTORY_PORT`, both controllers, both services, gateway; confirm `npm run build -w core_microservice` and `cd apps/core_microservice && npx jest chats` pass (depends on T055–T058)
- [ ] T060 [P] [US1] Create `apps/client_app/src/lib/api/chats.ts`: typed functions for `createDirectChat`, `listChats`, `getChat`, `listMessages`, `getMessageChanges`, `sendMessage`, `markRead` using `coreRequest` and the `@repo/contracts` chat types, plus TanStack Query key factories (`chatKeys.list()`, `chatKeys.detail(id)`, `chatKeys.messages(id)`)
- [ ] T061 [US1] Create `apps/client_app/src/lib/realtime/chat-cache.ts`: handlers that apply `message:new`, `chat:upsert` and `chat:read` to the TanStack Query cache by upserting on `message.id` and sorting by `seq`; keep a per-chat `max(changeSeq)` cursor; on socket reconnect refetch `GET /chats`, then for each loaded chat whose `lastChangeSeq` is ahead of its cursor page through `GET /chats/:id/messages/changes?afterChangeSeq=` until `hasMore` is false (FR-006, SC-003). Register the handlers from `RealtimeProvider` (depends on T036, T060)
- [ ] T167 [US1] Add user search for starting conversations (FR-007: no follow relationship required): `ISearchProfilesQuery { q; limit? }` in `packages/contracts/src/profiles/requests.ts` (export it and rebuild contracts); `searchByUsername(prefix, limit, excludeAuthUserId)` on `IUserProfileRepository` in `apps/core_microservice/src/modules/profiles/domain/interfaces/user-profile-repository.port.ts` and its TypeORM adapter (case-insensitive prefix match on `username`, deleted profiles left out); `GET /profiles/search?q=` in `apps/core_microservice/src/modules/profiles/profiles.controller.ts` (`JwtAuthGuard`, `q` 2–50 chars, `limit` 1–20 default 10, returns `IChatUser[]`, the caller left out), declared **before** `GET /profiles/:id` so the route isn't shadowed; a case in `profiles.controller.spec.ts`; `searchProfiles` in `apps/client_app/src/lib/api/profiles.ts` (depends on T034)
- [ ] T062 [US1] Create the conversation list page `apps/client_app/src/app/messages/page.tsx` with `apps/client_app/src/components/chat/conversation-list.tsx` (title or counterpart name, avatar, last message preview, unread badge, ordered by `lastActivityAt`) and a "New message" action using `apps/client_app/src/components/chat/new-direct-chat-dialog.tsx`. The dialog has a search box backed by `searchProfiles` (T167), so any existing user can be found; when the box is empty it shows the caller's following and followers (`GET /follows/:me/following`, `GET /follows/:me/followers`) as suggestions. Picking a user calls `createDirectChat` and navigates to the chat. Add a "Messages" link in `apps/client_app/src/components/nav/nav-links.tsx` (depends on T060, T061, T167)
- [ ] T063 [US1] Create the conversation page `apps/client_app/src/app/messages/[chatId]/page.tsx` with `apps/client_app/src/components/chat/message-list.tsx` (infinite scroll upward with `beforeSeq`, rendered in ascending `seq`, own vs others' bubbles, pending/sent/failed state per `clientMessageId`) and `apps/client_app/src/components/chat/message-composer.tsx` (generates `crypto.randomUUID()` per message and reuses it on retry; enforces 2,000 chars). Call `markRead` with the highest visible `seq` on open and when new messages arrive while open; a 404 shows "Conversation not found" (depends on T060, T061)

**Checkpoint**: MVP. quickstart.md US1 steps 1–8 pass, `npx jest` in core is green, and `realtime.e2e-spec.ts` passes locally.

---

## Phase 4: User Story 2 - Group conversations (Priority: P2)

**Goal**: Named groups of 3–100 people with admin-managed membership, leave with admin succession, visibility from the latest join, and live room sync.

**Independent Test**: quickstart.md §4 "US2". A creates "Weekend Trip" with B and C; messages arrive live for all; B gets 403 on admin actions; added D sees no earlier messages; removed C gets `chat:removed` and 404; B leaves and A sees "B left"; A leaves and D becomes admin.

### Tests for User Story 2

- [ ] T064 [P] [US2] Extend `apps/core_microservice/src/modules/chats/domain/entities/chat.entity.spec.ts` with group rules: `createGroup` rejects a title that is empty or over 100 chars after trim (`InvalidGroupTitleError`), fewer than 2 or more than 99 other members or duplicates or including the creator (`InvalidGroupSizeError`), makes the creator `ADMIN`, returns a `group_created` system event; `addMembers` by a non-admin → `NotChatAdminError`, past 100 active → `InvalidGroupSizeError`, re-adding a departed user reactivates the row with `leftAt = null`, a new `joinedAt` and `joinedSeq = lastSeq`; `removeMember` of self or a non-member → `NotAParticipantError`; `promote` and `rename` require admin; `leave` with no admin left promotes the active member with the earliest `joinedAt` (ties by `joinedSeq`, then `userId`) and returns an `admin_promoted` event; every group method on a `DIRECT` chat → `NotAGroupChatError`
- [ ] T065 [P] [US2] Unit spec `apps/core_microservice/src/modules/chats/chat-membership.service.spec.ts` with mocked ports: each membership command writes its system message through `allocateSeq` in the same transaction; on remove/leave the gateway's `removeUserFromChat` and `chat:removed` happen **before** the `member_removed`/`member_left` `message:new` broadcast; on add the new members are joined to the room and get `chat:upsert`
- [ ] T066 [P] [US2] Extend `apps/core_microservice/test/realtime.e2e-spec.ts` with a group scenario: create with 2 others; a message reaches both; a removed member's socket gets `chat:removed` and not the following message; a re-added member's `GET /chats/:id/messages` contains nothing from before the re-add

### Implementation for User Story 2

- [ ] T067 [P] [US2] Add to `apps/core_microservice/src/modules/chats/domain/errors/chat.errors.ts`: `InvalidGroupTitleError`, `InvalidGroupSizeError`, `NotAGroupChatError`, `NotAParticipantError` (400) and `NotChatAdminError extends AccessDeniedError` (403)
- [ ] T068 [US2] Add `static system(chatId, actorId, event, seq)` to `apps/core_microservice/src/modules/chats/domain/entities/message.entity.ts`: `kind = SYSTEM`, `content = null`, `clientMessageId = null`, `systemEvent = { type, actorId, targetUserIds?, title? }` where `type` is `group_created | member_added | member_removed | member_left | admin_promoted | group_renamed`
- [ ] T069 [US2] Add group methods to `apps/core_microservice/src/modules/chats/domain/entities/chat.entity.ts`, each returning the system event(s) to write: `static createGroup(creatorId, title, memberIds)` ("Title is 1–100 chars after trim. `memberIds` are distinct, don't include the creator, and number **2 to 99**. The creator becomes `ADMIN`"); `addMembers(actorId, userIds)` ("`GROUP` only. The actor is an active admin. Active members after the add are ≤ 100. Each user is inserted, or reactivated with `joinedSeq` set to the current `lastSeq`"); `removeMember(actorId, userId)` ("The actor is an admin and the target is an active member other than the actor. Sets `leftAt`"); `promote(actorId, userId)` ("The target is an active `MEMBER`, who becomes `ADMIN`"); `rename(actorId, title)`; `leave(userId)` with succession ("the active member with the earliest `joinedAt` (ties broken by `joinedSeq`, then `userId`) becomes `ADMIN`") (depends on T067, T068)
- [ ] T070 [P] [US2] Create DTOs in `apps/core_microservice/src/modules/chats/dto/`: `create-group-chat.dto.ts` (`@IsString() @Length(1, 100) title` after `@Transform` trim; `@IsArray() @ArrayMinSize(2) @ArrayMaxSize(99) @ArrayUnique() @IsUUID('all', { each: true }) memberIds`), `rename-group.dto.ts` (title 1–100), `add-members.dto.ts` (`userIds` 1–98, unique, UUIDs)
- [ ] T071 [US2] Create `apps/core_microservice/src/modules/chats/chat-membership.service.ts`: `createGroup` (asserts every member exists via `USER_DIRECTORY_PORT`, `UserNotFoundError` on any unknown id), `rename`, `addMembers`, `removeMember`, `promote`, `leave`. Each runs in one transaction that applies the entity method, allocates a `seq` per system event via `allocateSeq`, and inserts the system message(s) (so `lastActivityAt` moves too). After commit: added users → `joinUserToChat` + `chat:upsert`; removed/departed user → `removeUserFromChat` + `chat:removed { chatId, reason: 'removed' | 'left' }` **first**, then `message:new` for the system message to `chat:{id}`, then `chat:upsert` to remaining members when title or membership changed (depends on T065, T069)
- [ ] T072 [US2] Add routes to `apps/core_microservice/src/modules/chats/chats.controller.ts`: `POST /chats/groups` (201), `PATCH /chats/:chatId` (200 detail), `POST /chats/:chatId/members` (200 detail), `DELETE /chats/:chatId/members/:userId` (204), `POST /chats/:chatId/members/:userId/promote` (200 detail), `POST /chats/:chatId/leave` (204); register `ChatMembershipService` in `apps/core_microservice/src/modules/chats/chats.module.ts` (depends on T070, T071)
- [ ] T073 [P] [US2] Add `createGroupChat`, `renameGroup`, `addMembers`, `removeMember`, `promoteMember`, `leaveChat` to `apps/client_app/src/lib/api/chats.ts`, and handle `chat:removed` in `apps/client_app/src/lib/realtime/chat-cache.ts` (drop the chat from list and message caches; redirect away if it is open)
- [ ] T074 [US2] Create `apps/client_app/src/components/chat/new-group-dialog.tsx` (title + multi-select of at least 2 users using the same search and suggestions as T062) and open it from `apps/client_app/src/app/messages/page.tsx`; create `apps/client_app/src/components/chat/group-members-panel.tsx` (member list with roles; admin-only rename, add, remove and promote controls; "Leave group" for everyone) shown from `apps/client_app/src/app/messages/[chatId]/page.tsx` (depends on T073, T167)
- [ ] T075 [US2] Render `SYSTEM` messages as centered lines in `apps/client_app/src/components/chat/system-message.tsx` ("A created the group", "A added D", "A removed C", "B left", "D is now an admin", "A renamed the group to …") and use it from `apps/client_app/src/components/chat/message-list.tsx`

**Checkpoint**: quickstart.md US2 steps 1–8 pass. US1 still passes.

---

## Phase 5: User Story 3 - Typing indicators and conversation list (Priority: P2)

**Goal**: Live "typing…" indicators that expire after 5 s, and a conversation list that reorders live with the latest preview.

**Independent Test**: quickstart.md §4 "US3". B sees "A is typing…" within 1 s; it disappears within 6 s of A stopping, or right away when A sends; three typers show "several people are typing"; a new message moves its conversation to the top.

### Tests for User Story 3

- [ ] T076 [P] [US3] Unit spec `apps/core_microservice/src/modules/chats/infrastructure/realtime/chats.gateway.spec.ts` for typing: `typing:start` from a socket not in `chat:{chatId}` is ignored; a member's `typing:start` is broadcast to `chat:{id}` except `user:{typer}` with `isTyping: true` and the typer's `IChatUser`; a second `typing:start` within 2 s from the same socket and chat is not relayed; `typing:stop` relays `isTyping: false`; a blacklisted `jti` is rejected before relaying

### Implementation for User Story 3

- [ ] T077 [US3] Add `typing:start` and `typing:stop` handlers to `apps/core_microservice/src/modules/chats/infrastructure/realtime/chats.gateway.ts`: re-check the blacklist, require `socket.rooms.has('chat:{chatId}')`, throttle to one relay per 2 s per socket per chat (in-memory map on `socket.data`), resolve the typer's `IChatUser` once per socket via `USER_DIRECTORY_PORT` and cache it on `socket.data`, then `server.to('chat:{chatId}').except('user:{userId}').emit('typing', { chatId, user, isTyping })`. Nothing is stored (FR-020). Add `emitTypingStopped(chatId, userId)` to `IChatRealtimePort` (depends on T058)
- [ ] T078 [US3] In `apps/core_microservice/src/modules/chats/messages.service.ts`, after a successful send emit `typing { isTyping: false }` for the sender via `emitTypingStopped` (FR-019), and add that expectation to `apps/core_microservice/src/modules/chats/messages.service.spec.ts` (depends on T077)
- [ ] T079 [P] [US3] Create `apps/client_app/src/components/chat/use-typing-signal.ts`: while the composer value is non-empty and changing, emit `typing:start { chatId }` at most once every 3 s; emit `typing:stop` when the input is cleared or blurred, and on unmount
- [ ] T080 [P] [US3] Create `apps/client_app/src/components/chat/typing-indicator.tsx` with a `useTypingUsers(chatId)` hook: listen to `typing`, keep entries keyed by `user.userId`, drop each after 5 s without renewal or on `isTyping: false` or when that user's `message:new` arrives; render "Anna is typing…", "Anna and Ben are typing…", or "several people are typing" for 3 or more
- [ ] T081 [US3] Wire `use-typing-signal` into `apps/client_app/src/components/chat/message-composer.tsx` and render `typing-indicator` in `apps/client_app/src/app/messages/[chatId]/page.tsx`; in `apps/client_app/src/lib/realtime/chat-cache.ts` make `message:new` update the list item's `lastMessage` and `lastActivityAt`, bump `unreadCount` by 1 when the chat isn't open, the author isn't me, and the upsert **inserted** a new `message.id` (so catch-up replays from T061 and the `chat:alert` toast never add to it), and re-sort the list so that conversation moves to the top (FR-012, US3-4) (depends on T079, T080)

**Checkpoint**: quickstart.md US3 steps 1–4 pass.

---

## Phase 6: User Story 4 - Edit and delete own messages (Priority: P3)

**Goal**: Authors edit or delete their own messages; everyone sees the change live; deleted messages become placeholders.

**Independent Test**: quickstart.md §4 "US4". A's edit shows "edited · time" for B live; a delete shows a placeholder; B gets 403 on A's messages; editing a deleted message → 400; edit-to-empty without attachments → 400.

### Tests for User Story 4

- [ ] T082 [P] [US4] Extend `apps/core_microservice/src/modules/chats/domain/entities/message.entity.spec.ts`: `edit` by a non-author → `NotMessageAuthorError`; on a deleted message → `MessageAlreadyDeletedError`; on a `SYSTEM` message → `SystemMessageImmutableError`; to empty with no attachments → `EmptyMessageError`; to empty with attachments → allowed with `content = null`; over 2,000 → `MessageTooLongError`; success sets `editedAt` and the new `changeSeq`. `delete` by a non-author → `NotMessageAuthorError`; twice → `MessageAlreadyDeletedError`; success sets `content = null`, `deletedAt`, the new `changeSeq` and clears attachments
- [ ] T083 [P] [US4] Extend `apps/core_microservice/src/modules/chats/messages.service.spec.ts`: edit and delete allocate a new `changeSeq` in the transaction and emit `message:updated { message }` / `message:deleted { chatId, messageId, changeSeq }` after commit; a non-participant gets `ChatNotFoundError`; a message not visible to the caller (`seq <= joinedSeq`) → `ChatNotFoundError`

### Implementation for User Story 4

- [ ] T084 [P] [US4] Add to `apps/core_microservice/src/modules/chats/domain/errors/chat.errors.ts`: `NotMessageAuthorError extends AccessDeniedError` (403), `MessageAlreadyDeletedError` and `SystemMessageImmutableError` (400), `MessageNotFoundError extends EntityNotFoundError` (404)
- [ ] T085 [US4] Add to `apps/core_microservice/src/modules/chats/domain/entities/message.entity.ts`: `edit(actorId, content, changeSeq)` ("`kind = USER`. The actor is the author. Not deleted. The new content follows the length rule. The result must not be empty unless the message has attachments. Sets `editedAt`") and `delete(actorId, changeSeq)` ("`kind = USER`. The actor is the author. Not already deleted. Sets `content = null`, `deletedAt = now()` and clears attachments"). State: `ACTIVE → EDITED → DELETED` (terminal) (depends on T084)
- [ ] T086 [P] [US4] Create `apps/core_microservice/src/modules/chats/dto/edit-message.dto.ts` (`@IsString() @MaxLength(2000) content`, 0–2000, implements `IEditMessageRequest`)
- [ ] T087 [US4] Add `findVisibleById(chatId, messageId, joinedSeq)` and `update(message, tx)` (including removal of its `message_assets` rows when deleted) to `apps/core_microservice/src/modules/chats/domain/interfaces/message-repository.port.ts` and `apps/core_microservice/src/modules/chats/infrastructure/repository/message.repository.ts` (depends on T085)
- [ ] T088 [US4] Add `edit(me, chatId, messageId, dto)` and `delete(me, chatId, messageId)` to `apps/core_microservice/src/modules/chats/messages.service.ts`: in one transaction `assertCanPost`, load the visible message (else `MessageNotFoundError`), `allocateSeq` for the new `changeSeq`, apply the entity method, update; after commit emit `message:updated` or `message:deleted` to `chat:{id}` (FR-024). Expose a `onMessageDeleted` hook point for US5 (depends on T087)
- [ ] T089 [US4] Add `PATCH /chats/:chatId/messages/:messageId` (200 `IMessage`) and `DELETE /chats/:chatId/messages/:messageId` (204) to `apps/core_microservice/src/modules/chats/messages.controller.ts` (depends on T086, T088)
- [ ] T090 [P] [US4] Add `editMessage` and `deleteMessage` to `apps/client_app/src/lib/api/chats.ts`, and handle `message:updated` (upsert) and `message:deleted` (turn into a tombstone with `content: null`, `attachments: []`, `deletedAt` set, cursor bumped to `changeSeq`) in `apps/client_app/src/lib/realtime/chat-cache.ts`
- [ ] T091 [US4] Add an own-message action menu (Edit, Delete with confirm) and inline edit mode to `apps/client_app/src/components/chat/message-bubble.tsx`, used by `message-list.tsx`; show "edited · {time}" when `editedAt` is set and a "message deleted" placeholder when `deletedAt` is set; hide actions on others' and system messages (depends on T090)

**Checkpoint**: quickstart.md US4 steps 1–5 pass.

---

## Phase 7: User Story 5 - File attachments in messages (Priority: P3)

**Goal**: Up to 10 private attachments per message, type- and size-checked, served only to participants through short-lived signed URLs, shown inline or as downloads.

**Independent Test**: quickstart.md §4 "US5". Two images and a PDF arrive live with previews and an original-name download; an 11 MB file and a renamed `.exe` are rejected; C gets 404 on the attachment URL endpoint; raw MinIO URLs without a signature return 403.

### Tests for User Story 5

- [ ] T092 [P] [US5] Unit spec `apps/core_microservice/src/modules/assets/domain/entities/asset.entity.spec.ts`: `Asset.createPrivate` sets `visibility = PRIVATE`, requires `storageKey`, leaves `url` null, sanitizes `originalName` (path parts and control characters removed, max 255)
- [ ] T093 [P] [US5] Extend `apps/core_microservice/src/modules/chats/domain/entities/message.entity.spec.ts`: `Message.create` with an attachment candidate that is missing, isn't the author's, isn't `PRIVATE`, or is already attached → `InvalidAttachmentError`. Extend `apps/core_microservice/src/modules/chats/messages.service.spec.ts` (orchestration only): candidates are loaded through `ATTACHMENT_STORAGE_PORT` and passed to `Message.create`; a unique violation on `assetId` maps to `InvalidAttachmentError`; valid ids are stored with `displayOrder` matching request order; deleting a message with attachments soft-deletes the assets and calls storage `delete` for each key after commit, and a storage failure is logged, not thrown
- [ ] T094 [P] [US5] E2E spec `apps/core_microservice/test/attachments.e2e-spec.ts`: uploading a PNG, a PDF and a `.txt` succeeds; an 11 MB file is rejected; an `.exe` renamed to `.pdf` is rejected with a message naming the detected type; a participant's `GET /chats/:id/messages/:mid/attachments/:aid` returns a URL that downloads the bytes; an outsider gets 404; after deletion the endpoint returns 404

### Implementation for User Story 5

- [ ] T095 [US5] Create migration `apps/core_microservice/src/migrations/<timestamp>-AddPrivateAssets.ts`: `assets."url"` becomes NULL-able; add `"visibility" varchar(10) NOT NULL DEFAULT 'PUBLIC'`, `"bucket" varchar(63) NULL`, `"storageKey" varchar(255) NULL`, `"originalName" varchar(255) NULL`; full `down()`
- [ ] T096 [US5] Update `apps/core_microservice/src/modules/assets/domain/entities/asset.entity.ts` and `apps/core_microservice/src/modules/assets/domain/interfaces/asset-props.ts`: `url` nullable ("Public assets only"), `visibility` `PUBLIC | PRIVATE`, `bucket` (null for existing public rows), `storageKey` ("Required for `PRIVATE`"), `originalName` ("Sanitized: path parts and control characters removed"); add `static createPrivate({ uploaderId, bucket, storageKey, mimeType, size, originalName })` and `softDelete()`; keep `Asset.create` unchanged for public uploads (depends on T095)
- [ ] T097 [US5] Add `s3.privateBucket` (`S3_PRIVATE_BUCKET_NAME`, required) and `s3.publicEndpoint` (`S3_PUBLIC_ENDPOINT`, default `S3_ENDPOINT`) to `apps/core_microservice/src/config/app-config.service.ts`
- [ ] T098 [US5] Extend `apps/core_microservice/src/modules/assets/domain/interfaces/file-storage.port.ts` and `apps/core_microservice/src/modules/assets/infrastructure/storage/s3-storage.adapter.ts` with `uploadPrivate(file, key)` (private bucket, no public URL), `presignGet(key, { ttlSeconds, downloadName? })` using `@aws-sdk/s3-request-presigner` and a second `S3Client` pointed at `s3.publicEndpoint` (sets `ResponseContentDisposition: attachment; filename="…"` when `downloadName` is given), and `delete(key)` (depends on T097)
- [ ] T099 [US5] Add `uploadPrivate(uploaderId, file)`, `findByIds(ids)`, `softDeleteMany(ids)` to `apps/core_microservice/src/modules/assets/assets.service.ts` and `apps/core_microservice/src/modules/assets/infrastructure/repository/asset.repository.ts`; storage key `chat/{uploaderId}/{uuid}`; export the service from `apps/core_microservice/src/modules/assets/assets.module.ts` (depends on T096, T098)
- [ ] T100 [US5] Create `IAttachmentStoragePort` (`ATTACHMENT_STORAGE_PORT`: `upload`, `findAssets`, `presign(asset)` → `{ url, expiresAt }` with a 15-minute TTL and `downloadName` for non-image/video types, `deleteObjects(keys)`) in `apps/core_microservice/src/modules/chats/domain/interfaces/attachment-storage.port.ts` and its adapter over `AssetsService` in `apps/core_microservice/src/modules/chats/infrastructure/storage/attachment-storage.adapter.ts`; bind it in `apps/core_microservice/src/modules/chats/chats.module.ts` (depends on T099)
- [ ] T101 [P] [US5] Add `InvalidAttachmentError` (400) to `apps/core_microservice/src/modules/chats/domain/errors/chat.errors.ts`
- [ ] T102 [US5] Create `apps/core_microservice/src/modules/chats/attachments.controller.ts` with `POST /chats/attachments` (`FileInterceptor('file')`, `ParseFilePipe` with `MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })` and `FileTypeValidator({ fileType: <allow-list regex>, fallbackToMimetype: true })` for `image/jpeg|png|gif|webp`, `video/mp4|webm|quicktime`, `application/pdf`, `text/plain`, `text/csv` and the OOXML `docx`/`xlsx`/`pptx` types; error message names the detected type, e.g. "type application/x-msdownload not allowed"), returning 201 `IUploadedAttachment` (depends on T100)
- [ ] T103 [US5] Move attachment eligibility into the domain: `Message.create` in `apps/core_microservice/src/modules/chats/domain/entities/message.entity.ts` takes `attachments: { assetId; found; uploaderId; visibility; alreadyAttached }[]` (in request order) instead of bare ids and throws `InvalidAttachmentError` for any candidate that is missing, not `PRIVATE`, not uploaded by the author, or already attached. In `apps/core_microservice/src/modules/chats/messages.service.ts` `send`: load the candidates for `attachmentIds` through `ATTACHMENT_STORAGE_PORT` and pass them to `Message.create` (the service makes no eligibility decision itself); insert `message_assets` rows with `displayOrder` = request index in the same transaction (the unique `assetId` index is the race backstop, mapped to `InvalidAttachmentError`). In `delete`, soft-delete the message's assets in the transaction and after commit call `deleteObjects` best-effort with a logged warning on failure (FR-023) (depends on T100, T101)
- [ ] T104 [US5] In `apps/core_microservice/src/modules/chats/dto/chat-response.mapper.ts` fill `IMessage.attachments` ordered by `displayOrder`, each with a presigned `url`, `urlExpiresAt`, `originalName`, `mimeType`, `size` and `kind` (`image/*` → `image`, `video/*` → `video`, else `file`); load attachments in `message.repository.ts` page queries. Add `GET /chats/:chatId/messages/:messageId/attachments/:assetId` to `apps/core_microservice/src/modules/chats/attachments.controller.ts` that re-checks participant visibility and returns a fresh `IAttachmentUrl`, else 404 (depends on T103)
- [ ] T105 [P] [US5] Add `uploadAttachment(file)` (FormData) and `getAttachmentUrl(chatId, messageId, assetId)` to `apps/client_app/src/lib/api/chats.ts`
- [ ] T106 [US5] Add an attach button to `apps/client_app/src/components/chat/message-composer.tsx` with `apps/client_app/src/components/chat/attachment-picker.tsx`: up to 10 files, client-side 10 MB check, upload each before send with progress, reorderable chips, removable, shows the server's rejection reason, and sends `attachmentIds` in the chosen order with optional text (depends on T105)
- [ ] T107 [US5] Create `apps/client_app/src/components/chat/message-attachments.tsx` rendering `image` as inline `<img>`, `video` as inline `<video controls>`, `file` as a download link with `originalName` and size; when a URL has passed `urlExpiresAt` (or the element errors) fetch a fresh one with `getAttachmentUrl`; use it in `message-bubble.tsx` (depends on T105)

**Checkpoint**: quickstart.md US5 steps 1–7 pass.

---

## Phase 8: User Story 6 - Notifications for messages and social activity (Priority: P3)

**Goal**: Likes on posts and comments; reliable social events through an outbox and RabbitMQ; a rebuilt notifications service that stores notifications, serves them, and sends retry-limited emails per preferences; live in-app delivery through core; unread and unseen badges.

**Independent Test**: quickstart.md §4 "US6" and "Resilience". B gets a toast and unread badge for A's message while elsewhere; opening the chat clears it in all tabs; follow, like and comment give B 3 live notifications and 4 emails in Mailpit; repeated like/unlike gives no extra notification; turning off like emails stops only like emails; events survive a stopped notifications service.

### Tests for User Story 6

- [ ] T108 [P] [US6] Entity specs (create or extend) `apps/core_microservice/src/modules/posts/domain/entities/post.entity.spec.ts` and `apps/core_microservice/src/modules/comments/domain/entities/comment.entity.spec.ts`: `Post.assertLikeableBy` passes for a `PUBLISHED` post or the author, and throws the posts not-found error otherwise; `Post.notifiesAuthorOfLikeBy` is false for the author; `Comment.assertLikeableBy` follows its post; `Comment.notifiesAuthorOfLikeBy` is false for the comment author. Unit spec `apps/core_microservice/src/modules/likes/likes.service.spec.ts` with mocked ports (orchestration only): `assertLikeableBy` is called before the insert; a first-ever like that `notifiesAuthorOfLikeBy` writes one `social.post.liked` outbox row in the same transaction; a restore (`inserted = false`) writes none; unliking an un-liked item is a no-op returning `{ liked: false }`; the same for comments with `social.comment.liked`
- [ ] T109 [P] [US6] Unit spec `apps/core_microservice/src/common/messaging/outbox-relay.spec.ts`: publishes pending rows in `occurredAt` order with `messageId = id` and the envelope `{ eventId, type, version: 1, occurredAt, payload }`; sets `publishedAt` only after the confirm; on a publish error increments `attempts`, stores `lastError` and leaves the row pending
- [ ] T110 [P] [US6] Extend `apps/core_microservice/src/modules/chats/messages.service.spec.ts`: for each recipient with no socket viewing the chat, `send` writes one `chat.message.alerted` outbox row in the send transaction and emits `chat:alert` to `user:{id}` after commit (preview ≤ 100 chars, or "📎 Attachment"); a recipient who is viewing gets neither; the sender never gets one
- [ ] T111 [P] [US6] Entity specs: `Comment.notifiesPostAuthor(post)` is true only for a top-level comment by someone other than the post author (in `comment.entity.spec.ts`); `Follow.notifiesFollowed()` is false when `followerId === followingId` (new `apps/core_microservice/src/modules/follows/domain/entities/follow.entity.spec.ts`). Unit specs `apps/core_microservice/src/modules/comments/comments.service.spec.ts` and new `apps/core_microservice/src/modules/follows/follows.service.spec.ts` (orchestration only): `social.post.commented` is written in the comment transaction exactly when `notifiesPostAuthor` is true; a new follow writes `social.user.followed` when `notifiesFollowed` is true; an existing follow writes nothing
- [ ] T112 [P] [US6] Unit spec `apps/auth_microservice/src/middleware/internal-token.middleware.spec.ts`: missing or wrong `X-Internal-Token` → 401 and a warn log; correct token passes; comparison uses `crypto.timingSafeEqual` (different-length input doesn't throw). Add a supertest case: `GET /internal/users/:id/contact` against the public `createApp()` returns 404 (the route exists only on `createInternalApp()`)
- [ ] T113 [P] [US6] Unit spec `apps/notifications_consumer_microservice/src/modules/notifications/domain/entities/notification.entity.spec.ts`: `Notification.fromEvent` returns `null` when `actorId === recipientId`; maps each routing key to `kind`/`targetType`/`targetId`/`postId` (`USER_FOLLOWED` → `PROFILE` with the follower's id); trims `excerpt` to 140 chars; `markSeen(now)` sets `seenAt` once and never moves it
- [ ] T114 [P] [US6] Unit spec `apps/notifications_consumer_microservice/src/modules/preferences/domain/entities/notification-preferences.entity.spec.ts`: `defaults(userId)` has all four switches `true`; `allowsEmailFor` maps `NEW_MESSAGE` → `emailMessages`, `POST_COMMENTED` → `emailComments`, `POST_LIKED`/`COMMENT_LIKED` → `emailLikes`, `USER_FOLLOWED` → `emailFollows`
- [ ] T115 [P] [US6] Unit spec `apps/notifications_consumer_microservice/src/modules/notifications/application/social-event.handler.spec.ts`: a new event inserts `processed_events` and the notification in one transaction, then publishes `notification.created` and, when allowed, an `EmailJob`, then sets `followUpDone`; a replayed `eventId` with `followUpDone = true` does nothing; with `followUpDone = false` re-runs only the publish and email steps; a like partial-unique conflict counts as a duplicate; email-off preferences publish no job; an invalid payload is rejected to the DLQ
- [ ] T116 [P] [US6] Unit spec `apps/notifications_consumer_microservice/src/modules/notifications/application/email.worker.spec.ts`: a job whose `email_deliveries` row is `SENT` is skipped; a send failure increments `attempts` and re-queues to retry; the 3rd failure marks `FAILED`, logs at error with `jobId` and reason, and acks; success marks `SENT` with `sentAt`; also `message-alert.handler.spec.ts` in the same folder: `chat.message.alerted` stores no notification and publishes an `EmailJob` with `kind: 'NEW_MESSAGE'` only when `emailMessages` is on, idempotent on `eventId`
- [ ] T117 [P] [US6] E2E spec `apps/core_microservice/test/notifications-relay.e2e-spec.ts` (needs `docker:up` and the notifications service running): A likes B's published post, B's socket receives `notification:new` with `kind: 'POST_LIKED'` and `unseenCount: 1`; `POST /notifications/seen` as B in one session produces `notifications:seen` on B's other socket; unlike and like again produces no second event

### Implementation for User Story 6: core messaging (outbox + RabbitMQ)

- [ ] T118 [P] [US6] Create broker event classes with `class-validator` decorators in `packages/shared/src/events/`: `event-envelope.ts` (`EventEnvelope<T> { eventId; type; version: 1; occurredAt; payload }`, `ActorSnapshot { userId; username; displayName; avatarUrl }`, `RoutingKeys` constants for the 7 keys, `EXCHANGE_NAME = 'innogram.events'`), `social.events.ts` (`PostCommentedPayload`, `PostLikedPayload`, `CommentLikedPayload`, `UserFollowedPayload`; excerpts "≤ 140"), `chat-message-alerted.event.ts` (preview "≤ 100"), `notification.events.ts` (`NotificationCreatedPayload { recipientId; notification; unseenCount }`, `NotificationSeenPayload { userId; unseenCount: 0 }`), `email-job.ts` (`EmailJob` per contracts/broker-events.md); export all from `packages/shared/src/index.ts` and rebuild
- [ ] T119 [US6] Add `rabbitmq.url` (`RABBITMQ_URL`, `getOrThrow`) to `apps/core_microservice/src/config/app-config.service.ts`
- [ ] T120 [US6] Create migration `apps/core_microservice/src/migrations/<timestamp>-AddOutboxEvents.ts` and entity `apps/core_microservice/src/common/messaging/outbox-event.entity.ts` for `outbox_events`: `id` uuid PK ("Also the envelope `eventId`"), `routingKey` varchar(100), `payload` jsonb, `occurredAt` timestamptz, `publishedAt` timestamptz null ("null = pending"), `attempts` int default 0, `lastError` text null; partial index `("occurredAt") WHERE "publishedAt" IS NULL`
- [ ] T121 [US6] Create `IOutboxPort` (`OUTBOX_PORT`: `add(routingKey, payload, tx: EntityManager)`) in `apps/core_microservice/src/common/messaging/outbox.port.ts` and `TypeormOutboxAdapter` in `apps/core_microservice/src/common/messaging/typeorm-outbox.adapter.ts` that inserts through the caller's transaction manager and signals the relay to wake after commit (depends on T120)
- [ ] T122 [US6] Create `apps/core_microservice/src/common/messaging/amqp-connection.provider.ts` (`amqp-connection-manager` connection from `rabbitmq.url`, logs connect/disconnect) and `EventBusPort` + `AmqpEventBus` in `apps/core_microservice/src/common/messaging/{event-bus.port,amqp-event-bus}.ts`: a confirm channel that asserts the durable topic exchange `innogram.events` and publishes persistent JSON with `messageId = eventId` and `contentType: application/json` (depends on T118, T119)
- [ ] T123 [US6] Create `OutboxRelay` in `apps/core_microservice/src/common/messaging/outbox-relay.ts`: on module init logs `Outbox relay started` and polls every 500 ms (and on wake-up), selecting pending rows `FOR UPDATE SKIP LOCKED` in `occurredAt` order (batch 100), publishing each through `EventBusPort`, setting `publishedAt` after confirm or incrementing `attempts`/`lastError` on failure; purges published rows older than 7 days hourly; stops cleanly on shutdown (depends on T121, T122)
- [ ] T124 [US6] Create `MessagingModule` in `apps/core_microservice/src/common/messaging/messaging.module.ts` exporting `OUTBOX_PORT` and `EventBusPort`, and import it in `apps/core_microservice/src/app.module.ts` (depends on T123)

### Implementation for User Story 6: likes (FR-040, FR-041, FR-035)

- [ ] T125 [P] [US6] Create `OptionalJwtAuthGuard` in `apps/core_microservice/src/common/auth/optional-jwt-auth.guard.ts`: no token → allow with no `request.user`; a token that verifies → set `request.user`; an invalid token → allow as anonymous; `unavailable` → allow as anonymous
- [ ] T126 [US6] Create the `likes` module in `apps/core_microservice/src/modules/likes/`: ports `domain/interfaces/{post-like-repository,comment-like-repository}.port.ts` (`like(itemId, userId, tx)` → `{ inserted }`, `unlike`, `count`, `likedBy`), adapters `infrastructure/repository/{post-like,comment-like}.repository.ts` using `INSERT … ON CONFLICT ("postId","userId") DO UPDATE SET "deletedAt" = NULL … RETURNING (xmax = 0) AS inserted` (and the comment equivalent), entity methods holding the rules (constitution Principle II): `Post.assertLikeableBy(viewerId)` (throws the posts module's not-found error unless `status === PUBLISHED` or the viewer is the author) and `Post.notifiesAuthorOfLikeBy(likerId)` (`likerId !== authorId`) in `apps/core_microservice/src/modules/posts/domain/entities/post.entity.ts`, `Comment.assertLikeableBy(viewerId, post)` (delegates to the post) and `Comment.notifiesAuthorOfLikeBy(likerId)` in `apps/core_microservice/src/modules/comments/domain/entities/comment.entity.ts`; `likes.service.ts` (loads the item, calls `assertLikeableBy`, and on `inserted && notifiesAuthorOfLikeBy(liker)` writes `social.post.liked` / `social.comment.liked` with an `ActorSnapshot` from `USER_DIRECTORY_PORT` and an excerpt ≤ 140 through `OUTBOX_PORT` in the same transaction; unlike sets `deletedAt` and emits nothing), `likes.controller.ts` (`PUT`/`DELETE /posts/:postId/like`, `PUT`/`DELETE /comments/:commentId/like`, all `JwtAuthGuard`, 200 `ILikeState`), `likes.module.ts`; register it in `apps/core_microservice/src/app.module.ts` (depends on T034, T124)
- [ ] T127 [US6] Add `likeCount: number` and `likedByMe: boolean` to `IPostResponse` in `packages/contracts/src/posts/responses.ts` and to a comment response interface (create `packages/contracts/src/comments/{responses,index}.ts` if none exists, and export it); rebuild contracts
- [ ] T128 [US6] Add `likeCount` (`COUNT(*) WHERE "deletedAt" IS NULL`) and `likedByMe` (`EXISTS` for the viewer, `false` when anonymous) to `apps/core_microservice/src/modules/posts/dto/post-response.dto.ts` and `apps/core_microservice/src/modules/comments/dto/comment-response.dto.ts`, computed in `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts` and `apps/core_microservice/src/modules/comments/infrastructure/repository/comment.repository.ts` for `GET /posts/feed`, `GET /posts/:id`, `GET /posts/search` and `GET /comments/post/:postId`; switch the public ones in `posts.controller.ts` and `comments.controller.ts` to `OptionalJwtAuthGuard` so they still work without a token; update `posts.controller.spec.ts`/`comments.controller.spec.ts` (depends on T125, T127)

### Implementation for User Story 6: social events from existing endpoints

- [ ] T129 [US6] Add `Comment.notifiesPostAuthor(post): boolean` (`parentId == null && authorId !== post.authorId`) to `apps/core_microservice/src/modules/comments/domain/entities/comment.entity.ts`. In `apps/core_microservice/src/modules/comments/comments.service.ts`, create the comment and, when `comment.notifiesPostAuthor(post)` is true, write `social.post.commented { actor, recipientId, postId, commentId, excerpt ≤ 140 }` through `OUTBOX_PORT` in the same transaction (depends on T124)
- [ ] T130 [US6] Add `Follow.notifiesFollowed(): boolean` (`followerId !== followingId`) to `apps/core_microservice/src/modules/follows/domain/entities/follow.entity.ts`. In `apps/core_microservice/src/modules/follows/follows.service.ts`, when a follow row is created (not the existing-row early return) and `follow.notifiesFollowed()` is true, save it and write `social.user.followed { actor, recipientId }` through `OUTBOX_PORT` in one transaction (depends on T124)

### Implementation for User Story 6: core chat alerts and notification relay

- [ ] T131 [US6] Add the `chat:view { chatId | null }` handler to `apps/core_microservice/src/modules/chats/infrastructure/realtime/chats.gateway.ts`: re-check the blacklist; set `socket.data.viewingChatId` only if the socket is in `chat:{chatId}`, else clear it; ack `{ ok: true }`
- [ ] T132 [US6] In `apps/core_microservice/src/modules/chats/messages.service.ts` `send` (USER messages only): inside the transaction, for each active recipient other than the sender with `!isUserViewingChat(userId, chatId)`, write a `chat.message.alerted { actor, recipientId, chatId, messageId, chatTitle, preview ≤ 100 or "📎 Attachment" }` outbox row; after commit emit `chat:alert` with the same data to `user:{recipientId}` (FR-028, FR-034) (depends on T124, T131)
- [ ] T133 [US6] Create the `notifications-relay` module in `apps/core_microservice/src/modules/notifications-relay/`: `notifications-relay.consumer.ts` asserts durable queue `core.realtime-relay` bound to `notification.#` on `innogram.events`, validates payloads, emits `notification:new { notification, unseenCount }` or `notifications:seen { unseenCount: 0 }` to `user:{id}` through `CHAT_REALTIME_PORT`, and on a handler error requeues once then drops with a warning; `notifications-relay.module.ts` imported in `apps/core_microservice/src/app.module.ts`. Core stores nothing (depends on T033, T122)

### Implementation for User Story 6: auth internal contact endpoint (contracts/auth-internal.md §3)

- [ ] T134 [US6] In `apps/auth_microservice/src/config/env.ts`: read `INTERNAL_API_TOKEN` with `requireEnv` and **no default**, and throw at startup if it is shorter than 32 characters (fail fast); add `env.app.internalPort` (`AUTH_INTERNAL_PORT`, default 3012) and `env.app.internalHost` (`AUTH_INTERNAL_HOST`, default `127.0.0.1`)
- [ ] T135 [US6] Create `apps/auth_microservice/src/middleware/internal-token.middleware.ts` (constant-time compare of `X-Internal-Token` against `INTERNAL_API_TOKEN`, 401 + warn log on mismatch) and `apps/auth_microservice/src/routes/internal.routes.ts` with `GET /internal/users/:id/contact` → 200 `{ userId, email }` or 404 via the user repository. Serve it from a **separate internal listener** (constitution Principle V: internal-only endpoints are not publicly exposed): add `createInternalApp(dataSource, logger)` to `apps/auth_microservice/src/app.ts`, a separate Express app with `express.json()`, `helmet()`, the internal-token middleware, the `/internal` router and `errorHandler`, **no CORS** and no Swagger; in `apps/auth_microservice/src/main.ts` start it with `listen(env.app.internalPort, env.app.internalHost)` and close it in `shutdown`. The public `createApp()` does **not** mount `/internal` (depends on T134)

### Implementation for User Story 6: notifications service rebuild (research §14)

- [ ] T136 [US6] Delete the stub files `apps/notifications_consumer_microservice/src/app.controller.ts`, `app.controller.spec.ts`, `app.service.ts`, `entities/notification.entity.ts` and the `src/notifications/` folder; create `apps/notifications_consumer_microservice/src/config/app-config.{module,service}.ts` (typed getters with `getOrThrow` for `DB_*` notifications vars, `RABBITMQ_URL`, `JWT_SECRET`, `REDIS_*`, `INTERNAL_API_TOKEN`, `AUTH_INTERNAL_URL`, `CLIENT_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, optional `SMTP_USER`/`SMTP_PASS`, `NOTIFICATIONS_PORT` default 3003)
- [ ] T137 [US6] Create migration `apps/notifications_consumer_microservice/src/migrations/<timestamp>-NotificationsV2.ts`: drop the stub `notifications` table; create `notifications` (`id` uuid PK, `recipientId` uuid, `actorId` uuid, `kind` varchar(30) `POST_COMMENTED | POST_LIKED | COMMENT_LIKED | USER_FOLLOWED`, `targetType` varchar(10) `POST | COMMENT | PROFILE`, `targetId` uuid, `postId` uuid null, `actorSnapshot` jsonb, `excerpt` varchar(140) null, `sourceEventId` uuid **unique**, `occurredAt` timestamptz, `seenAt` timestamptz null, `createdAt`; indexes `("recipientId","occurredAt" DESC)`, `("recipientId") WHERE "seenAt" IS NULL`, partial unique `("recipientId","kind","actorId","targetId") WHERE kind IN ('POST_LIKED','COMMENT_LIKED')`), `notification_preferences` (`userId` uuid PK, `emailMessages`/`emailComments`/`emailLikes`/`emailFollows` boolean default true, `updatedAt`), `processed_events` (`eventId` uuid PK, `routingKey` varchar(100), `followUpDone` boolean default false, `processedAt` timestamptz), `email_deliveries` (`jobId` varchar(80) PK, `recipientId` uuid, `kind` varchar(30), `status` varchar(10) `PENDING | SENT | FAILED`, `attempts` int, `lastError` text null, `sentAt` timestamptz null, `createdAt`/`updatedAt`), `recipient_contacts` (`userId` uuid PK, `email` varchar(255), `fetchedAt` timestamptz); full `down()`. Update `apps/notifications_consumer_microservice/data-source.ts` entity and migration globs for the new layout
- [ ] T138 [P] [US6] Create domain entities in `apps/notifications_consumer_microservice/src/modules/notifications/domain/entities/`: `notification.entity.ts` (`static fromEvent(envelope)` returns `null` for self-actions, maps kinds/targets, trims excerpt to 140; `markSeen(now)`; state `UNSEEN → SEEN`), `processed-event.entity.ts` (purged after 30 days), `email-delivery.entity.ts` (`PENDING → SENT | FAILED`, `recordFailure(error)` with "attempts ≤ 3", `markSent(now)`), `recipient-contact.entity.ts` (`isStale(now)` when older than 24 h) (depends on T137)
- [ ] T139 [P] [US6] Create `apps/notifications_consumer_microservice/src/modules/preferences/domain/entities/notification-preferences.entity.ts` with `static defaults(userId)` (all `true`), `allowsEmailFor(kind)`, `update(prefs)` (depends on T137)
- [ ] T140 [P] [US6] Create ports in `apps/notifications_consumer_microservice/src/modules/notifications/domain/interfaces/`: `notification-repository.port.ts` (`page(recipientId, { before?, limit })`, `unseenCount`, `markSeenUpTo(recipientId, upTo)`, `runInTransaction`), `recipient-directory.port.ts` (`getEmail(userId)`), `mailer.port.ts` (`send({ to, subject, text, html })`), `event-bus.port.ts` (`publish(routingKey, envelope)`, `enqueueEmail(job)`); and `apps/notifications_consumer_microservice/src/modules/preferences/domain/interfaces/preferences-repository.port.ts`
- [ ] T141 [US6] Create `apps/notifications_consumer_microservice/src/common/redis/redis.module.ts` (ioredis client) and `apps/notifications_consumer_microservice/src/common/auth/jwt-auth.guard.ts` + `current-user.decorator.ts` using the shared `AccessTokenVerifier` with the Redis blacklist (401 for `missing`/`invalid`/`revoked`, 503 for `unavailable`) (depends on T136)
- [ ] T142 [US6] Create TypeORM repository adapters in `apps/notifications_consumer_microservice/src/modules/notifications/infrastructure/repository/` (notifications, processed events, email deliveries, recipient contacts) and `apps/notifications_consumer_microservice/src/modules/preferences/infrastructure/preferences.repository.ts` (missing row → `defaults`) (depends on T138, T139, T140)
- [ ] T143 [US6] Create `apps/notifications_consumer_microservice/src/common/messaging/amqp-topology.ts` and `amqp-event-bus.adapter.ts`: on startup idempotently assert exchange `innogram.events` (topic, durable), queue `notifications.events` (durable, prefetch 20) bound to `social.#` and `chat.message.alerted`, retry queue `notifications.events.retry` (TTL 10 s, dead-letters back) and `notifications.events.dlq`, queue `notifications.email` with `notifications.email.retry` (TTL 30 s); publishes persistent messages via a confirm channel; consumer helpers that track attempts via an `x-attempts` header and route to retry or DLQ after 5 attempts with an error log (depends on T118, T136)
- [ ] T144 [US6] Create `apps/notifications_consumer_microservice/src/modules/notifications/infrastructure/auth-directory.adapter.ts` implementing `IRecipientDirectoryPort`: return the cached `recipient_contacts` email when fresh (< 24 h), else `GET ${AUTH_INTERNAL_URL}/internal/users/:id/contact` with `X-Internal-Token` and a 3 s timeout, upsert the cache, and throw on failure so the email job retries (depends on T142)
- [ ] T145 [P] [US6] Create `apps/notifications_consumer_microservice/src/modules/notifications/infrastructure/mail/nodemailer.adapter.ts` implementing `IMailerPort` over SMTP settings, and `email-templates.ts` rendering a plain-text and HTML body per kind (actor name, what happened, excerpt, deep link under `CLIENT_URL`: post, profile, or `/messages/{chatId}`) (depends on T140)
- [ ] T146 [US6] Create `apps/notifications_consumer_microservice/src/modules/notifications/application/social-event.handler.ts` following the processing order in contracts/broker-events.md: validate; in one transaction insert `processed_events(eventId)` (PK conflict → ack and stop unless `followUpDone = false`) and the notification from `Notification.fromEvent` (null → skip; like partial-unique conflict → duplicate); commit; publish `notification.created { recipientId, notification, unseenCount }`; if `allowsEmailFor(kind)` enqueue `EmailJob` with `jobId = {eventId}:{recipientId}`; set `followUpDone = true`; ack (depends on T142, T143)
- [ ] T147 [US6] Create `apps/notifications_consumer_microservice/src/modules/notifications/application/message-alert.handler.ts` for `chat.message.alerted`: idempotent on `processed_events`, stores no notification (FR-034), enqueues an `EmailJob` with `kind: 'NEW_MESSAGE'` only when `emailMessages` is on (depends on T142, T143)
- [ ] T148 [US6] Create `apps/notifications_consumer_microservice/src/modules/notifications/application/email.worker.ts` consuming `notifications.email`: insert-or-load `email_deliveries(jobId)`, skip if `SENT`, resolve the address via `IRecipientDirectoryPort`, render and send via `IMailerPort`, mark `SENT`; on failure record it and requeue to `notifications.email.retry` until 3 attempts, then mark `FAILED`, log at error with `jobId` and reason, and ack (FR-039) (depends on T144, T145)
- [ ] T149 [US6] Create `apps/notifications_consumer_microservice/src/modules/notifications/{notifications.service,notifications.controller}.ts`: `GET /notifications` (`before` ISO, `limit` 1–50 default 20, newest first, `{ items, hasMore, unseenCount }`), `GET /notifications/unseen-count`, `POST /notifications/seen` (`upTo` default now; marks seen, then publishes `notification.seen { userId, unseenCount: 0 }`); all guarded, recipient always `user.sub`; DTOs with `class-validator` implementing the contracts (depends on T141, T142, T143)
- [ ] T150 [US6] Create `apps/notifications_consumer_microservice/src/modules/preferences/{preferences.service,preferences.controller,preferences.module}.ts`: `GET /notifications/preferences` (defaults when no row) and `PUT /notifications/preferences` (all four booleans required, upsert) (depends on T141, T142)
- [ ] T151 [US6] Wire `apps/notifications_consumer_microservice/src/modules/notifications/notifications.module.ts` (ports bound to adapters with `Symbol` tokens, handlers registered as consumers on startup) and rewrite `apps/notifications_consumer_microservice/src/app.module.ts` (config, TypeORM for `innogram_notifications` with `synchronize: false`, logger, Redis, both modules) and `apps/notifications_consumer_microservice/src/main.ts` (listen on `NOTIFICATIONS_PORT`, CORS `CLIENT_URL`, global `ValidationPipe`, `DomainExceptionFilter`, Swagger); confirm `npm run build -w notifications_consumer_microservice` and its `npx jest` pass (depends on T146–T150)

### Implementation for User Story 6: client

- [ ] T152 [P] [US6] Create `apps/client_app/src/lib/api/notifications.ts` (`listNotifications`, `getUnseenCount`, `markSeen`, `getPreferences`, `updatePreferences` via `notificationsRequest`) and `apps/client_app/src/lib/api/likes.ts` (`likePost`, `unlikePost`, `likeComment`, `unlikeComment`), with query keys
- [ ] T153 [US6] Create `apps/client_app/src/lib/realtime/notification-cache.ts` handling `chat:alert` (toast "A: preview" linking to the chat; it does **not** touch `unreadCount`, which `message:new` owns in T081, so one message counts once), `chat:read` (set unread for that chat), `notification:new` (prepend to the list cache, set unseen count), `notifications:seen` (unseen = 0, mark cached items seen); register from `RealtimeProvider`. Create `apps/client_app/src/components/notifications/toast-host.tsx` mounted in `apps/client_app/src/app/layout.tsx` (depends on T036, T152)
- [ ] T154 [US6] Emit `chat:view { chatId }` when `apps/client_app/src/app/messages/[chatId]/page.tsx` is open and visible, and `chat:view { chatId: null }` on route change, unmount and `document.visibilityState === 'hidden'`; re-send the current value after every socket reconnect
- [ ] T155 [US6] Add badges to `apps/client_app/src/components/nav/header.tsx`/`nav-links.tsx`: Messages shows the sum of `unreadCount` across conversations; a bell links to `/notifications` and shows `unseenCount` from `GET /notifications/unseen-count` on load, kept live by T153 (depends on T153)
- [ ] T156 [US6] Create `apps/client_app/src/app/notifications/page.tsx` with `apps/client_app/src/components/notifications/notification-item.tsx`: newest first with "load more", unseen ones highlighted; on open call `markSeen` (badge to 0 everywhere); each item names the actor and the action and links to the post (comment kinds via `postId`) or the actor's profile; if the target returns 404, show "This content is no longer available" (depends on T152)
- [ ] T157 [P] [US6] Create `apps/client_app/src/app/settings/notifications/page.tsx`: four toggles (Messages, Comments, Likes, Follows) loaded from `GET /notifications/preferences` and saved with `PUT`, with a saved confirmation
- [ ] T158 [US6] Create `apps/client_app/src/components/likes/like-button.tsx` (optimistic toggle, count, reconciles with the returned `ILikeState`) and use it on each post in `apps/client_app/src/components/feed/feed-list.tsx`; create `apps/client_app/src/components/comments/post-comments.tsx` (lists `GET /comments/post/:postId` with a like button per comment and a minimal composer posting to `POST /comments`) shown under each post (depends on T128, T152)

**Checkpoint**: quickstart.md US6 steps 1–9 and Resilience steps 1–6 pass; core and notifications unit suites are green; `notifications-relay.e2e-spec.ts` passes locally.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Load check, documentation, and the final verification gates.

- [ ] T159 [P] Create the manual load script `apps/core_microservice/test/load/group-fanout.ts` (`--members 100 --messages 50`): creates or signs in 100 users, creates one group, opens 100 authenticated sockets, sends messages over HTTP and prints p95 `message:new` delivery latency (target ≤ 2 s, SC-005)
- [ ] T160 [P] Update `AGENTS.md` and `CLAUDE.md`: the notifications service is no longer a stub (its own DB, REST API on 3003, RabbitMQ consumer, email); RabbitMQ is now used (exchange `innogram.events`, outbox in core); new env vars; Mailpit; core's `/realtime` Socket.IO namespace; the `auth:session-revoked` channel; auth's `/internal/users/:id/contact` endpoint
- [ ] T161 [P] Rewrite `apps/notifications_consumer_microservice/README.md` for the new structure, queues, endpoints and local run steps
- [ ] T162 [P] Add Swagger decorators (`@ApiTags`, `@ApiBearerAuth`, response types) to every new core controller in `apps/core_microservice/src/modules/{chats,likes}/` and the notifications controllers
- [ ] T163 Security pass against SC-004 and constitution Principle V: confirm every new core and notifications route has `JwtAuthGuard` (or the internal token), non-participants get 404 on every `chatId`/`messageId`/`assetId` route, `innogram-private` has no anonymous policy, auth's internal listener (`AUTH_INTERNAL_PORT`) is not published or proxied and the public auth port answers 404 for `/internal/*`, no token is read from a query string, and new secrets fail fast at startup; fix any gap in the affected file
- [ ] T164 Run `npx turbo run lint` and `npx turbo run build` from the repo root and fix all errors (CI gates; `lint` runs `eslint --fix` and may change files)
- [ ] T165 Run `cd apps/core_microservice && npx jest`, `cd apps/notifications_consumer_microservice && npx jest`, `cd apps/auth_microservice && npx jest`, then `cd apps/core_microservice && npm run test:e2e` with `npm run docker:up` running; fix failures
- [ ] T166 Walk through every scenario in `specs/003-realtime-chat/quickstart.md` (setup checks, US1–US6, Resilience, load spot-check), including that one new message in a chat B isn't viewing raises B's unread badge by exactly 1 (with both the toast and `message:new` arriving), and record any deviation as a follow-up

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every story.**
- **US1 (Phase 3)**: depends on Foundational. It is the messaging core the other chat stories build on.
- **US2, US3, US4, US5 (Phases 4–7)**: each depends on US1 (entities, repositories, `messages.service.ts`, client chat pages). They don't depend on each other, though several edit the same files (`chat.errors.ts`, `messages.service.ts`, `message.entity.ts`, `chat-cache.ts`, `message-composer.tsx`), so run them one after another or merge carefully.
- **US6 (Phase 8)**: the likes, social events, notifications service, relay and client notification UI need only Foundational. The chat alert part (T110, T131, T132, T153 `chat:alert`/`chat:read`, T154) needs US1.
- **Polish (Phase 9)**: after the stories you intend to ship.

### User Story Dependencies

```text
Setup → Foundational ─┬─> US1 (MVP) ─┬─> US2 (groups)
                      │              ├─> US3 (typing, live list)
                      │              ├─> US4 (edit/delete) ──> US5 delete cleanup (T103)
                      │              └─> US5 (attachments)
                      └─> US6 social part (likes, outbox, notifications service, relay)
                                     └── US6 chat alerts need US1
```

US5's delete path (T103) extends `MessagesService.delete` from US4 (T088). If US5 ships before US4, move the asset cleanup into the US4 delete task.

### Within Each User Story

- Tests are written first and fail before the implementation.
- Migrations → entities and errors → ports → repositories → services → controllers and gateway → client.
- Rebuild `@repo/shared`/`@repo/contracts` after editing them.

### Parallel Opportunities

- Setup: T002–T007 together after T001.
- Foundational: T008, T010, T011, T012 (shared); T013–T016 (contracts); T019–T021 (auth); T025, T034 (core) run in parallel. T035 (client) can start right after T007.
- Each story's test tasks marked [P] run together.
- After US1, US2–US5 can be split across developers if file conflicts are managed. US6's social part can run from the end of Foundational in parallel with US1.
- Inside US6, the notifications service track (T136–T151), the auth track (T134–T135), the likes track (T125–T128) and the client track (T152, T157) are independent of each other until the end-to-end check.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "T037 chat.entity.spec.ts in apps/core_microservice/src/modules/chats/domain/entities/"
Task: "T038 chat-participant.entity.spec.ts in the same folder"
Task: "T039 message.entity.spec.ts in the same folder"
Task: "T040 messages.service.spec.ts in apps/core_microservice/src/modules/chats/"
Task: "T043 realtime.e2e-spec.ts in apps/core_microservice/test/"

# Then independent building blocks, together:
Task: "T045 chat.errors.ts"
Task: "T047 chat-participant.entity.ts"
Task: "T049 message-attachment.entity.ts rename"
Task: "T050 chat and message repository ports"
Task: "T053 request DTOs"
Task: "T060 client lib/api/chats.ts"
Task: "T167 profile search endpoint and client call"
```

## Parallel Example: User Story 6

```bash
# Four independent tracks once Foundational is done:
Track A (core messaging + likes): T118 → T119 → T120 → T121 → T122 → T123 → T124 → T126 → T128 → T129 → T130
Track B (auth internal endpoint): T112 → T134 → T135
Track C (notifications service):  T113–T116 → T136 → T137 → T138/T139/T140 → T141–T151
Track D (client):                 T152 → T157 (others wait for the backend tracks)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup.
2. Phase 2 Foundational (secure socket handshake, revocation, contracts).
3. Phase 3 US1.
4. **Stop and validate** with quickstart.md US1 and `realtime.e2e-spec.ts`. This covers the "WebSocket connections are established and secure" and "messages are delivered in real-time" acceptance points for one-on-one chat.

### Incremental Delivery

1. Setup + Foundational → secure live channel.
2. US1 → private chat (MVP).
3. US2 → group chat ("private and group chats work correctly").
4. US3 → typing and live list.
5. US4 → edit and delete. US5 → attachments ("message editing/deletion and file attachments work").
6. US6 → notifications, likes and email.
7. Polish → docs, lint, build, full quickstart.

### Parallel Team Strategy

- Everyone: Setup + Foundational.
- Then developer A: US1 → US2 → US4; developer B: US6 social part (likes, outbox, notifications service, auth endpoint); developer C: client refresh/realtime, then US3 and US5 once US1's backend lands.
- Finish US6's chat alerts after US1 merges.

---

## Notes

- [P] tasks touch different files and don't depend on an unfinished task.
- `<timestamp>` in migration names means the current Unix epoch in milliseconds, as in the existing migrations.
- Existing behaviour that must stay green: `jwt-auth.guard.spec.ts`, posts/comments/profiles specs, auth specs.
- Out of scope (research §0): F12 (auth `GET /users/:id` unauthenticated) and F13 (core internal route on the public port). Raise them as separate tickets.
- Commit after each task or logical group, and stop at any checkpoint to validate a story on its own.
