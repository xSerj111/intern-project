# auth_microservice

Authentication service for Innogram: credentials, JWT access and refresh tokens, Redis-backed sessions and blacklists, and Google OAuth sign-in. It is bare Express (no NestJS) with manual dependency injection. Own database: `innogram_auth`. Default public port `3002` (`AUTH_PORT`).

## Architecture

Ports & Adapters, wired by hand in `createApp()` (`src/app.ts`). A second function, `createInternalApp()`, builds the service-to-service app. `src/main.ts` creates the DB connection and two Redis clients (cache/sessions, and a dedicated one for pub/sub), builds both apps and starts both listeners.

```
src/
  config/          env.ts (fail-fast validation), database, redis, google, swagger, openapi
  domain/          entities and interfaces (ports)
  infrastructure/  cache (Redis), crypto (bcrypt), events, health, jwt, oauth, repositories
  middleware/      auth, error handler, internal token, request validation
  routes/          auth, users, internal
  services/        AuthService, UsersService
  migrations/
```

Domain code throws `DomainError` subclasses (`@repo/shared`); `createErrorHandler` maps them to HTTP. The layering rules are the same as in [DDD_ARCHITECTURE_GUIDE.md](../../DDD_ARCHITECTURE_GUIDE.md).

## Routes

Public listener (`AUTH_PORT`, 3002):

| Route                                 | Purpose                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /users/register`                | Create a user. Publishes `UserCreatedEvent` to core (fire-and-forget, see below)              |
| `POST /auth/login`                    | Email and password login. Returns `{ accessToken, user }` and sets the `refresh_token` cookie |
| `POST /auth/google`                   | Google sign-in with an ID token (`GoogleLoginDto`); creates the user on first login           |
| `GET /auth/me`                        | Current user, requires a Bearer access token                                                  |
| `POST /auth/refresh`                  | Rotates the refresh token from the cookie and returns a new access token                      |
| `POST /auth/logout`                   | Revokes the session and clears the cookie                                                     |
| `GET /health`                         | Public, overall status only (200 or 503)                                                      |
| `GET /health/details`, `GET /metrics` | Internal-only, need `X-Internal-Token`                                                        |
| `GET /api`, `GET /api-json`           | Swagger UI and OpenAPI document (on outside production, controlled by `SWAGGER_ENABLED`)      |

Internal listener (`AUTH_INTERNAL_HOST`:`AUTH_INTERNAL_PORT`, default `127.0.0.1:3012`):

| Route                             | Purpose                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /internal/users/:id/contact` | Recipient address for the notifications service; guarded by `X-Internal-Token` (`INTERNAL_API_TOKEN`) |

The public port never serves `/internal`. In containers set `AUTH_INTERNAL_HOST=0.0.0.0` and never publish port 3012; notifications reaches it through `AUTH_INTERNAL_URL`. Full API reference: [docs/API.md](../../docs/API.md).

## Sessions, tokens and revocation

- The refresh token is an httpOnly cookie named `refresh_token` (path `/auth`). JSON responses carry only `{ accessToken, user }`, so the client calls auth with `credentials: 'include'` and `AUTH_ALLOWED_ORIGINS` must list the client origin. `AUTH_COOKIE_SAMESITE` defaults to `strict`; use `none` (with `NODE_ENV=production` for `Secure`) only when client and auth are on different sites.
- Redis holds refresh sessions (`refresh_tokens:<id>`) and token blacklists (`blacklist:refresh:<jti>`, `blacklist:access:<jti>`), each with a TTL equal to the time the token has left. Used refresh tokens are rotated and blacklisted.
- On logout, after the blacklists are written, auth publishes to the Redis channel `auth:session-revoked`. Core's `session-revocation.listener.ts` consumes it (for example to drop live sockets). A publish failure never fails the logout.
- Access tokens are signed with `JWT_SECRET`; core verifies them with the same secret and checks the access blacklist (failing closed with 503 when Redis is down).

## Auth to core

When a user is created, `UsersService` calls `HttpEventPublisher`, which POSTs `UserCreatedEvent` to core at `/internal/events/user-created` with `X-Internal-Token`, without awaiting. Failures are logged, not retried; core creates a missing profile lazily on first use.

## Google OAuth

`POST /auth/google` receives a Google ID token from the client and verifies it with `google-auth-library` against `GOOGLE_CLIENT_ID` (`infrastructure/oauth/google-oauth.service.ts`). The client id must match the one the web client uses.

## Environment

`config/env.ts` validates at startup and throws on a missing required variable. Required: `CORE_SERVICE_URL`, `AUTH_ALLOWED_ORIGINS`, `INTERNAL_API_TOKEN` (32+ characters). With `NODE_ENV=production`, `JWT_SECRET` and `JWT_REFRESH_SECRET` are also required, at least 32 characters, and must not be the `.env.example` or `.env.production.example` placeholders. Also read: `AUTH_PORT`, `AUTH_SERVICE_URL`, `AUTH_INTERNAL_PORT`, `AUTH_INTERNAL_HOST`, `AUTH_COOKIE_SAMESITE`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `GOOGLE_CLIENT_ID`, `BCRYPT_SALT_ROUNDS`, `SWAGGER_ENABLED`, `POSTGRES_*`, `DB_NAME_AUTH`, `REDIS_*`. Copy `.env.example` to the root `.env`; the full table is in [docs/ENVIRONMENT.md](../../docs/ENVIRONMENT.md).

## Commands

Run from `apps/auth_microservice`. Start infrastructure first with `npm run docker:up` from the repo root.

| Task                                   | Command                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Dev server (ts-node-dev, respawn)      | `npm run dev`                                                                                                    |
| Build / run built app                  | `npm run build`, then `npm start` (`node dist/main.js`)                                                          |
| Unit tests                             | `npm test` (one spec: `npx jest auth.service`)                                                                   |
| Coverage (70 lines / 60 branches gate) | `npm run test:cov`                                                                                               |
| Lint / type-check                      | `npm run lint:check`, `npm run type-check`                                                                       |
| Migrations                             | `npm run migration:run` (also `migration:generate`, `migration:revert`); in a built image `npm run migrate:prod` |
| Seed dev data                          | `npm run db:seed` (perf dataset: `npm run db:seed -- --profile perf --reset`)                                    |

Observability: [docs/OBSERVABILITY.md](../../docs/OBSERVABILITY.md). Deployment: [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).
