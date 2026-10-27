# Realtime (Socket.IO) contract

The `/realtime` Socket.IO namespace served by `core_microservice` carries live chat messages, chat membership changes, typing state, and social notifications to the web client.

Source of truth: `packages/contracts/src/realtime/events.ts`. It exports `ServerToClientEvents` and `ClientToServerEvents`. The gateway (`apps/core_microservice/src/modules/chats/infrastructure/realtime/chats.gateway.ts`) and the client (`apps/client_app/src/lib/realtime/realtime-provider.tsx`) are both typed from it. Payload types reuse `IMessage`, `IConversationSummary`, `IReadState` and `INotification` from `@repo/contracts`.

## Connection

| Item | Value |
|------|-------|
| URL | `${NEXT_PUBLIC_CORE_SERVICE_URL}/realtime` on the client (default `http://localhost:3001`). Namespace `/realtime`, default Socket.IO path `/socket.io`. |
| Auth | `io(url, { auth: (cb) => cb({ token }) })`. The token is passed as a callback, so every reconnect sends the latest access token. The token is read from `handshake.auth.token` only. A query-string token is ignored. |
| CORS | Origin is `CLIENT_URL`, with `credentials: true`. |
| Transports | `websocket`, falling back to `polling`. |
| On connect | The server verifies the token (signature, expiry, `jti`, access blacklist). It then joins the socket to `user:{userId}` and to `chat:{id}` for every active chat the user participates in. It also schedules the token expiry timer. |
| Handshake rejection | `connect_error` with `err.message` set to `unauthorized` (missing, invalid, expired or revoked token) or `unavailable` (Redis is down, so core fails closed). |

On `unauthorized`, the client refreshes the access token and retries once, then signs out. On `unavailable` and other errors, it retries with backoff (up to 5 transient retries, 1 s base, 30 s cap) and reconnects with up to 10 transport attempts.

### Rooms

- `user:{userId}` contains all of a user's sockets. Per-user events go here.
- `chat:{chatId}` contains the sockets of the chat's current active participants. Chat events go here.

The client cannot join or leave rooms. Only the server changes room membership, when a user is added to or removed from a chat.

## Server to client

| Event | Room | Payload | When it is sent |
|-------|------|---------|-----------------|
| `message:new` | `chat:{id}` | `{ message: IMessage }` | A user or system message is created. The sender's other tabs receive it too. `message.changeSeq` is included. |
| `message:updated` | `chat:{id}` | `{ message: IMessage }` | A message is edited. `message.changeSeq` is included. |
| `message:deleted` | `chat:{id}` | `{ chatId; messageId; changeSeq; deletedAt }` | A message is deleted. `deletedAt` is an ISO string with the tombstone's deletion time. The client replaces the message with a placeholder. |
| `chat:upsert` | `user:{id}` | `{ conversation: IConversationSummary }` | The user is added to a chat, a new direct chat is created for them, or a rename or membership change affects how the chat is listed. |
| `chat:removed` | `user:{id}` | `{ chatId; reason: 'removed' \| 'left' }` | The user lost access to the chat. The socket leaves the chat room before the `member_removed` or `member_left` system message is broadcast, so the removed user gets this event instead of the system message. |
| `chat:read` | `user:{id}` | `IReadState` | The user's read position changed. It goes to all of the user's sockets, including the one that marked the chat as read. |
| `chat:alert` | `user:{id}` | `{ chatId; messageId; actor: IChatUser; chatTitle: string \| null; preview: string }` | A new message in a chat the user participates in, sent only when none of the user's sockets is viewing that chat. `preview` is at most 100 characters, or `📎 Attachment` for an attachment-only message. |
| `typing` | `chat:{id}`, except the typer's own sockets | `{ chatId; user: IChatUser; isTyping: boolean }` | A participant starts or stops typing, or sends a message (which stops typing). Nothing is stored on the server. The client expires an entry after 5 s without a renewal. |
| `notification:new` | `user:{id}` | `{ notification: INotification; unseenCount: number }` | A social notification (relayed from `notifications_consumer_microservice`). |
| `notifications:seen` | `user:{id}` | `{ unseenCount: 0 }` | The user marked notifications as seen in another session. |
| `session:expired` | that socket only | `{ reason: 'expired' \| 'revoked' }` | Sent right before the server disconnects the socket. `expired` means the access token expired, and the client refreshes and reconnects. `revoked` means the session was revoked, and the client signs out. |

Notes:

- `notification:new` and `notifications:seen` are the only notification events. They come from the RabbitMQ relay (`apps/core_microservice/src/modules/notifications-relay/`). The relay consumes the `core.realtime-relay` queue, bound to `notification.#`. It handles `notification.created` and `notification.seen`, and emits to the recipient's `user:{id}` room.
- `session:expired` with `revoked` is also sent when the auth service publishes a logout on the `auth:session-revoked` Redis channel. Core's session revocation listener then disconnects the matching sockets.

## Client to server

Every handler re-checks the access token blacklist for the socket's current `jti` before it runs. If the session is revoked, the server emits `session:expired` with `revoked` and disconnects. If Redis is unavailable, the handler fails closed with an `unavailable` ack.

Acks use one of two shapes: `{ ok: true, ... }` on success, or `{ ok: false, error: { code, message } }` on failure. Handlers without an ack are fire-and-forget.

| Event | Payload | Ack | Server behaviour |
|-------|---------|-----|------------------|
| `chat:view` | `{ chatId: string \| null }` | `{ ok: true }` or error | Sets `socket.data.viewingChatId` to `chatId` if the socket is in `chat:{chatId}`, otherwise to `null`. This drives the "is viewing" check for `chat:alert`. The client sends `null` on route change and when the page is hidden. |
| `typing:start` | `{ chatId }` | none | If the socket is in `chat:{chatId}`, relays `typing` with `isTyping: true`. Throttled to one relay per 2 s per socket per chat. |
| `typing:stop` | `{ chatId }` | none | If the socket is in `chat:{chatId}`, relays `typing` with `isTyping: false`. The next `typing:start` for that chat is relayed immediately. |
| `auth:renew` | `{ token }` | `{ ok: true; expiresAt: string }` or error | Verifies the new token. It must have the same `sub`, and the same `sid` when the socket has one. On success the server updates `jti`, `sid` and `exp`, and resets the expiry timer. On failure it sends an `unauthorized` ack and disconnects. |

## Ordering and delivery

- Chat events are emitted after the database commit, in commit order. Each message carries `changeSeq`. The client keeps the highest `changeSeq` per loaded chat as its catch-up cursor, and sorts by `changeSeq` if events arrive out of order.
- Delivery is best-effort while connected. After a disconnect, the client recovers missed messages through the HTTP catch-up endpoint `GET /chats/:chatId/messages/changes`.
- The server never sends a chat's events to a socket outside that chat's room.
- `chat:alert` is best-effort. The outbox row still drives the email notification.

## Operational limits

- Core has no Socket.IO Redis adapter. The `chat:alert` "is viewing" check reads the in-memory adapter. Run one core instance, or a notification reaches only the sockets on the instance that consumes it.
- Expiry timers are per socket. The server disconnects a socket when its access token expires, so the client must renew the token with `auth:renew` or reconnect.
