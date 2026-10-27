# API guide

Innogram has three HTTP backends. Each documents its own routes in OpenAPI. This page covers what the schemas do not: how to find them, how authentication works end to end, and the conventions every list, error and upload follows. Live chat and live notifications use Socket.IO, which is described in [realtime.md](./realtime.md).

## Interactive docs (Swagger)

| Service                                               | Default URL                                    | Swagger UI | Raw OpenAPI JSON |
| ----------------------------------------------------- | ---------------------------------------------- | ---------- | ---------------- |
| Core (`core_microservice`)                            | `http://localhost:3001` (`CORE_PORT`)          | `/api`     | `/api-json`      |
| Auth (`auth_microservice`)                            | `http://localhost:3002` (`AUTH_PORT`)          | `/api/`    | `/api-json`      |
| Notifications (`notifications_consumer_microservice`) | `http://localhost:3003` (`NOTIFICATIONS_PORT`) | `/api`     | `/api-json`      |

Notes:

- Auth's UI is served from `/api/` (trailing slash) on the public port. The internal listener (`AUTH_INTERNAL_PORT`) serves no Swagger.
- Core and notifications have an `Authorize` button (HTTP bearer). Paste an access token (without the `Bearer ` prefix) to call guarded routes.
- The internal-only routes (`/health/details`, `/metrics`, core's `/internal/events/user-created`, auth's `/internal/users/:id/contact`) are deliberately not in the documents.

### `SWAGGER_ENABLED`

All three backends read the same variable:

- unset or empty: Swagger is **on**, unless `NODE_ENV=production`, where it is off;
- `true` / `false`: forces it on or off, whatever `NODE_ENV` is.

All three services are strict: any value other than `true` or `false` stops the service at startup (notifications accepts either case). When disabled, `/api` and `/api-json` return 404.

## Authentication flow

Auth issues two tokens. The **access token** is a short-lived JWT (`JWT_EXPIRES_IN`, default `15m`) that the client sends as `Authorization: Bearer <token>` to core and notifications. The **refresh token** (`JWT_REFRESH_EXPIRES_IN`, default `7d`) never appears in a JSON body: it lives in an httpOnly cookie.

| Step     | Request                                                                                  | Result                                                                                               |
| -------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Register | `POST {AUTH}/users/register` with `{ email, password }` (password at least 8 characters) | `201` with the user (no password hash). It does **not** sign the user in. Duplicate email is `409`.  |
| Log in   | `POST {AUTH}/auth/login` with `{ email, password }`                                      | `200` with `{ accessToken, user }` and a `Set-Cookie: refresh_token`. Wrong credentials are `401`.   |
| Google   | `POST {AUTH}/auth/google` with `{ idToken }`                                             | Same response as login.                                                                              |
| Who am I | `GET {AUTH}/auth/me` with the bearer token                                               | `200` with `{ statusCode: 200, user }`.                                                              |
| Refresh  | `POST {AUTH}/auth/refresh` (no body, cookie only)                                        | `200` with a new `{ accessToken, user }` and a rotated cookie. A missing or invalid cookie is `401`. |
| Log out  | `POST {AUTH}/auth/logout` (cookie, optional bearer token)                                | `200` with `{ message: 'Logged out successfully' }`. Clears the cookie and revokes the session.      |

### The refresh cookie

| Attribute  | Value                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Name       | `refresh_token`                                                                                     |
| Path       | `/auth` (the browser sends it only to login, refresh and logout, never to core or notifications)    |
| `HttpOnly` | always                                                                                              |
| `Secure`   | when `NODE_ENV=production`                                                                          |
| `SameSite` | `AUTH_COOKIE_SAMESITE`: `strict` (default), `lax` or `none`. Any other value stops auth at startup. |

Because the cookie belongs to auth's origin, every browser call to auth must opt in:

```ts
await fetch(`${AUTH_SERVICE_URL}/auth/refresh`, {
  method: "POST",
  credentials: "include",
});
```

Without `credentials: 'include'` the browser neither stores nor sends the cookie. Auth answers CORS with `credentials: true` for the origins listed in `AUTH_ALLOWED_ORIGINS` (comma-separated), so the client origin must be in that list.

`strict` works while client and auth share a site (for example `localhost:3000` and `localhost:3002`). If they are on different sites, set `AUTH_COOKIE_SAMESITE=none`, which browsers accept only together with `Secure` (`NODE_ENV=production`) over HTTPS.

### Using the access token

Core and notifications verify the access token locally and also check Redis for a revoked token or session. When Redis is unreachable, core's `JwtAuthGuard` fails closed with `503` instead of letting the request through. When the access token expires (`401`), call `/auth/refresh` once and retry.

## Conventions

### Paging

Every `limit` is capped at `PAGE_SIZE_MAX`, which is **50** (`@repo/contracts`, `packages/contracts/src/common/pagination.ts`). The message changes feed is the one exception: `limit` up to `CHANGES_PAGE_SIZE_MAX` (200). Out-of-range or non-integer values are rejected with `400`; they are never clamped.

| Endpoint                                                           | Style    | Params                               | Default `limit` |
| ------------------------------------------------------------------ | -------- | ------------------------------------ | --------------- |
| `GET /posts/feed`                                                  | cursor   | `cursor`, `limit`                    | 20              |
| `GET /posts/search`, `GET /posts/author/:userId`                   | offset   | `page`, `limit`                      | 20              |
| `GET /comments/post/:postId`                                       | offset   | `page`, `limit`                      | 20              |
| `GET /follows/:userId/followers`, `GET /follows/:userId/following` | offset   | `page`, `limit`                      | 50              |
| `GET /profiles/search`                                             | `limit`  | `limit`                              | 10              |
| `GET /chats`                                                       | cursor   | `before`, `limit`                    | 20              |
| `GET /chats/:chatId/messages`                                      | sequence | `beforeSeq`, `limit`                 | 50              |
| `GET /chats/:chatId/messages/changes`                              | sequence | `afterChangeSeq` (required), `limit` | 200 (max 200)   |
| `GET /notifications` (notifications service)                       | cursor   | `before`, `limit`                    | 20 (max 50)     |

Check each route's exact parameters in its Swagger UI. The table lists the style, not every filter.

**Cursor feed.** `GET /posts/feed` takes an opaque `cursor` and returns `{ items, nextCursor }`. Pass the previous response's `nextCursor` as `cursor` for the next page; `nextCursor` is `null` when there is nothing more. Omit `cursor` for the first page. A malformed cursor is `400`. The feed does not accept `page`: sending it is `400` with the message `page is not supported; use cursor`.

**Offset lists** return `{ items, page, limit, hasMore }`.

### Errors

All backends answer errors with JSON containing `statusCode` and `message`.

Domain errors (business-rule violations thrown by entities and repositories) are mapped by core's `DomainExceptionFilter` (`@repo/shared`) and by auth's error handler to the same body:

```json
{
  "statusCode": 404,
  "error": "EntityByIdNotFoundError",
  "message": "Post with id ... not found"
}
```

`error` is the class name of the domain error and `message` is human readable. The status mapping is:

| Domain error                                     | Status |
| ------------------------------------------------ | ------ |
| `EntityNotFoundError`, `EntityByIdNotFoundError` | 404    |
| `AccessDeniedError`                              | 403    |
| `UniqueConstraintViolationError`                 | 409    |
| `UnauthorizedError` (auth only)                  | 401    |
| `DatabaseQueryError`                             | 500    |
| any other `DomainError`                          | 400    |

Other responses:

- **Validation (400).** Request DTOs are validated in every service. A failed body or query returns `{ statusCode: 400, error: 'Bad Request', message: [<one string per violated rule>] }`. Core strips unknown properties instead of rejecting them. Auth's `validate` middleware returns the same shape.
- **Malformed JSON (400).** Auth returns `{ message: 'Malformed JSON body' }`; the body is never echoed.
- **401.** Missing, invalid, expired or revoked access token. Core and notifications send Nest's `{ statusCode, message, error: 'Unauthorized' }`.
- **503.** Core's `JwtAuthGuard` when Redis is down.
- **500.** Unexpected errors return a generic `Internal Server Error` message. Details are logged server-side only.

Every response carries an `x-request-id` header (a valid incoming one is echoed, otherwise one is generated) and the same id appears in the logs. See [OBSERVABILITY.md](./OBSERVABILITY.md) for how to follow one.

### Two-step uploads

File bytes never pass through core. An upload is two calls plus one direct request to storage, all with the bearer token on the core calls:

1. `POST /uploads` with `{ purpose, contentType, size, fileName? }`.
   - `purpose` is `post-image`, `avatar` or `chat-attachment`.
   - `size` is 1 byte up to `UPLOAD_MAX_BYTES` (10 MiB).
   - `contentType` must be on the allowlist for the purpose (images for `post-image` and `avatar`; images, video, PDF, text and Office documents for `chat-attachment`).
   - Response `201`: `{ uploadId, url, fields, maxBytes, expiresAt }`. The link is valid for about 5 minutes (`UPLOAD_LINK_TTL_SEC`, default 300).
2. Send the file straight to storage: `POST` a `multipart/form-data` request to `url`, with every entry of `fields` first, verbatim, and the file last.
3. `POST /uploads/:uploadId/confirm`. Core checks size and the real file type (the first bytes, not the declared type), then finalizes the asset. It is idempotent: confirming twice is safe. It returns `200` with the asset (or, for `chat-attachment`, the attachment descriptor). Errors: `400` for an expired link, no uploaded object, too large or disallowed content; `404` for an unknown upload or one that is not the caller's.

Use the confirmed asset by id: `assetIds` when creating a post, `attachmentIds` when sending a chat message. Read a chat attachment back through `GET /chats/:chatId/messages/:messageId/attachments/:assetId`.

## Realtime

Live messages, typing, membership changes and notifications use the `/realtime` Socket.IO namespace, not REST. See [realtime.md](./realtime.md).
