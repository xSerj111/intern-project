# Notifications service

NestJS service for the Innogram notification feed, notification email preferences and email delivery. It owns the `innogram_notifications` database and consumes core's events from RabbitMQ.

## Structure

```
src/
  config/              AppConfigService (getOrThrow for required settings)
  common/
    redis/             Redis client module
    auth/              JwtAuthGuard, @CurrentUser(), access-token verifier
    messaging/         AMQP topology, connection, consumer host, retry policy
  modules/
    notifications/     feed, unseen count, mark-seen; event handlers; email worker
      domain/          entities, errors, ports
      application/     event handlers, email worker
      infrastructure/  TypeORM repositories, Nodemailer adapter, auth directory adapter
    preferences/       notification preferences (per user)
```

## Messaging

| Queue | Consumed by | Notes |
| --- | --- | --- |
| `notifications.events` | notifications | Bound on `innogram.events` to `social.#` and the chat-alert routing key. Has `.retry` and `.dlq` queues. |
| `notifications.email` | email worker | Direct sends only. Has a `.retry` queue; the third failure marks the delivery as FAILED. |

Notifications publishes `notification.created` and `notification.seen` to `innogram.events`. Core's `core.realtime-relay` queue (binding `notification.#`) pushes them to connected clients.

## HTTP API

Port `NOTIFICATIONS_PORT` (default `3003`). All routes need a bearer access token.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/notifications` | List the current user's notifications |
| GET | `/notifications/unseen-count` | Unseen count |
| POST | `/notifications/seen` | Mark notifications as seen |
| GET | `/notifications/preferences` | Read email preferences |
| PUT | `/notifications/preferences` | Update email preferences |

Swagger UI: `http://localhost:3003/api`.

## Environment

Set in the root `.env` (see `.env.example`):

- `NOTIFICATIONS_PORT`, `CLIENT_URL` (CORS origin)
- `DB_NAME_NOTIFICATIONS` and the `POSTGRES_*` settings
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `RABBITMQ_URL`
- `JWT_SECRET` (access-token verification)
- `INTERNAL_API_TOKEN`, `AUTH_INTERNAL_URL` (recipient contacts from auth's internal listener)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, optional `SMTP_USER` / `SMTP_PASS`. The defaults in `.env.example` target the local Mailpit container.

## Local run

```bash
# from the repo root: Postgres, Redis, RabbitMQ, MinIO and Mailpit
npm run docker:up

# build shared packages once, then run migrations for this service
npm run build -w @repo/shared -w @repo/contracts
cd apps/notifications_consumer_microservice
npm run migration:run

# start in watch mode
npm run start:dev
```

Useful URLs: Swagger at `http://localhost:3003/api`, Mailpit inbox at `http://localhost:8025`, RabbitMQ management at `http://localhost:15672`.

The service needs auth (for `AUTH_INTERNAL_URL`) and core (for events) to be running to see end-to-end behaviour.

## Tests

```bash
npm run test          # unit specs (*.spec.ts)
npm run test:e2e      # test/notifications.e2e-spec.ts
npm run test:cov      # coverage
```

## Migrations

```bash
npm run migration:generate   # generate from entity changes
npm run migration:run
npm run migration:revert
```

Migrations live in `src/migrations/`. `synchronize` is off.
