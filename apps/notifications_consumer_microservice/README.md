# Notifications service

NestJS service for the Innogram notification feed, notification email preferences and email delivery. It owns the `innogram_notifications` database, consumes core's events from RabbitMQ and sends email through SMTP.

Environment variables are listed in [docs/ENVIRONMENT.md](../../docs/ENVIRONMENT.md), metrics and health in [docs/OBSERVABILITY.md](../../docs/OBSERVABILITY.md).

## Structure

```
src/
  config/              AppConfigService (getOrThrow for required settings), env validation
  common/
    redis/             Redis client module
    auth/              JwtAuthGuard, @CurrentUser(), access-token verifier
    messaging/         AMQP topology, connection, consumer host, retry policy
    observability/     health, metrics, internal-token guard
  modules/
    notifications/     feed, unseen count, mark-seen; event handlers; email worker
      domain/          entities, errors, ports
      application/     event handlers, email worker
      infrastructure/  TypeORM repositories, Nodemailer adapter, auth directory adapter
    preferences/       notification preferences (per user)
```

## Messaging

| Queue                  | Consumed by   | Notes                                                                                                    |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `notifications.events` | notifications | Bound on `innogram.events` to `social.#` and the chat-alert routing key. Has `.retry` and `.dlq` queues. |
| `notifications.email`  | email worker  | Direct sends only. Has a `.retry` queue; the third failure marks the delivery as FAILED.                 |

Notifications publishes `notification.created` and `notification.seen` to `innogram.events`. Core's `core.realtime-relay` queue (binding `notification.#`) pushes them to connected clients.

## HTTP API

Port `NOTIFICATIONS_PORT` (default `3003`). All API routes need a bearer access token.

| Method | Path                          | Purpose                               |
| ------ | ----------------------------- | ------------------------------------- |
| GET    | `/notifications`              | List the current user's notifications |
| GET    | `/notifications/unseen-count` | Unseen count                          |
| POST   | `/notifications/seen`         | Mark notifications as seen            |
| GET    | `/notifications/preferences`  | Read email preferences                |
| PUT    | `/notifications/preferences`  | Update email preferences              |

Operational routes, none of which need a bearer token:

| Path                  | Access             | Purpose                                                                                                                   |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`         | Public             | Overall status only: `200` for `ok` or `degraded`, `503` for `unhealthy`. Dependency names and errors are never returned. |
| `GET /health/details` | `X-Internal-Token` | Per-check report (database, session Redis, broker, SMTP)                                                                  |
| `GET /metrics`        | `X-Internal-Token` | Prometheus text format                                                                                                    |

Swagger UI is served at `http://localhost:3003/api` when `SWAGGER_ENABLED` is on. It is on by default outside production and off when `NODE_ENV=production` unless `SWAGGER_ENABLED=true`.

## Request ids and AMQP correlation

- Every HTTP response carries an `X-Request-Id` header. A client-supplied `X-Request-Id` is kept when it is 1 to 128 characters of letters, digits, `.`, `_` or `-`; otherwise a UUID is generated.
- Messages this service publishes carry the id of the request or message that caused them in an `x-correlation-id` AMQP header.
- When the consumer handles a message, it reuses that `x-correlation-id` as the request id, so its log lines carry the id of the original request. Follow one request across services by searching logs for that id. See [docs/OBSERVABILITY.md](../../docs/OBSERVABILITY.md).

## Local run

```bash
# from the repo root: Postgres, Redis, RabbitMQ, SeaweedFS and Mailpit
npm run docker:up

# build shared packages once, then run migrations for this service
npm run build -w @repo/shared -w @repo/contracts
cd apps/notifications_consumer_microservice
npm run migration:run

# start in watch mode
npm run start:dev
```

`npm run db:migrate` from the repo root runs the same migration for every backend.

Useful URLs: Swagger at `http://localhost:3003/api`, Mailpit inbox at `http://localhost:8025`, RabbitMQ management at `http://localhost:15672`.

The service needs auth (for `AUTH_INTERNAL_URL`) and core (for events) to be running to see end-to-end behaviour.

## Production

The Docker image (`apps/notifications_consumer_microservice/Dockerfile`) runs `node dist/main.js` and listens on `3003`. The compose stack runs the migrations first in a one-shot `notifications-migrate` service, which executes `node dist/migrate.js` (`npm run migrate:prod` in this package). See [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## Tests

```bash
npm run test          # unit specs (*.spec.ts)
npm run test:e2e      # test/*.e2e-spec.ts (notifications, observability, openapi)
npm run test:cov      # coverage (70 lines / 60 branches)
npm run lint:check    # read-only ESLint
npm run type-check    # tsc --noEmit
```

## Migrations

```bash
npm run migration:generate   # generate from entity changes
npm run migration:run
npm run migration:revert
```

Migrations live in `src/migrations/`. `synchronize` is off.
