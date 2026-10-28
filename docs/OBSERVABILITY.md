# Observability

How to tell whether Innogram is healthy, find out why it is not, and follow one request through the services. Everything here is self-hosted: structured logs, Prometheus metrics, Prometheus alert rules and a Grafana dashboard. There is no Sentry or other SaaS, and no Alertmanager.

| Service       | Port var (default)          | `service` label |
| ------------- | --------------------------- | --------------- |
| core          | `CORE_PORT` (3001)          | `core`          |
| auth          | `AUTH_PORT` (3002)          | `auth`          |
| notifications | `NOTIFICATIONS_PORT` (3003) | `notifications` |

## 1. Health endpoints

Every backend serves the same three observability endpoints. None of them needs a JWT.

| Endpoint              | Access             | Returns                                                                                                                                         |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`         | public             | `{ "status": "healthy" \| "degraded" \| "unhealthy" }` only. Never dependency names or errors                                                   |
| `GET /health/details` | `X-Internal-Token` | `{ status, service, checkedAt, checks }`, one entry per dependency with `status` (`up`/`down`), `critical`, `latencyMs` and, when down, `error` |
| `GET /metrics`        | `X-Internal-Token` | Prometheus text format                                                                                                                          |

The token is `INTERNAL_API_TOKEN` (32+ characters, required by all three backends). A missing or wrong token gets `401 {"statusCode":401,"message":"Unauthorized"}`. Core and notifications check it with `InternalTokenGuard`, auth with `requireInternalToken`. Both compare in constant time.

```bash
# TOKEN is the value of INTERNAL_API_TOKEN from your .env / .env.production
curl -s -H "X-Internal-Token: $TOKEN" http://localhost:3001/health/details
curl -s -H "X-Internal-Token: $TOKEN" http://localhost:3001/metrics | head
```

### Status semantics

| Status      | HTTP | Meaning                                                                             |
| ----------- | ---- | ----------------------------------------------------------------------------------- |
| `healthy`   | 200  | Every check is `up`                                                                 |
| `degraded`  | 200  | Only non-critical checks are `down`. The service still works, with reduced function |
| `unhealthy` | 503  | At least one critical check is `down`                                               |

All checks run in parallel, each with a 1000 ms timeout. A timed-out check reports `error: "timeout"`; any other failure reports only the error class name, because driver messages can embed hosts or credentials.

`degraded` deliberately returns 200: the container healthchecks (`wget` against `/health` in each Dockerfile) and the compose `service_healthy` conditions treat the service as up, so a flaky optional dependency does not restart or block the stack. Alert on `degraded` through `/health/details` if you need to know.

### Checks per service

| Service       | Check            | Critical |
| ------------- | ---------------- | -------- |
| core          | `database`       | yes      |
| core          | `session_redis`  | yes      |
| core          | `cache_redis`    | no       |
| core          | `broker`         | no       |
| core          | `object_storage` | no       |
| auth          | `database`       | yes      |
| auth          | `redis`          | yes      |
| notifications | `database`       | yes      |
| notifications | `session_redis`  | yes      |
| notifications | `broker`         | yes      |
| notifications | `smtp`           | no       |

Core's response cache (`cache_redis`) fails open: a cache error or a 50 ms timeout is a miss, never a request error, so it only degrades the service.

## 2. Metrics catalogue

Each service has its own isolated prom-client registry. Every series carries a `service` label (`core`, `auth`, `notifications`) plus the labels below. Labels are bounded: route templates, class names and queue names, never raw URLs or ids.

### HTTP (all services)

| Metric                          | Type      | Labels                            | Notes                                                                                            |
| ------------------------------- | --------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_class` | Buckets 0.005 s to 5 s. `status_class` is `2xx`, `4xx`, `5xx`. Its `_count` is the request count |
| `http_request_errors_total`     | counter   | `method`, `route`, `status_class` | Responses with status 400 or above                                                               |

`route` is the matched route template (`/posts/:id`), or `unmatched` when no route matched or the matched route passed the request on and Express answered with its default 404 page. `/health`, `/health/details` and `/metrics` are not recorded.

### Database

| Metric                   | Type      | Labels                               | Services                              |
| ------------------------ | --------- | ------------------------------------ | ------------------------------------- |
| `db_pool_connections`    | gauge     | `state` = `total`, `idle`, `waiting` | core, auth, notifications             |
| `db_queries_per_request` | histogram | `route`                              | core only. Buckets 1 to 50 statements |

`db_pool_connections` is read from the pool on each scrape and has no series while the pool is unavailable. The pool size is not configurable through an env var.

### Cache and uploads (core)

| Metric                 | Type    | Labels               | Values                                                                  |
| ---------------------- | ------- | -------------------- | ----------------------------------------------------------------------- |
| `cache_requests_total` | counter | `resource`, `result` | `result` = `hit`, `miss`, `error`                                       |
| `uploads_total`        | counter | `purpose`, `outcome` | `outcome` = `confirmed`, `rejected_content`, `rejected_size`, `expired` |

### Outbox (core)

Core writes domain events to the `outbox_events` table in the same transaction as the business change, and a relay publishes them to RabbitMQ.

| Metric                          | Type    | Meaning                                                                       |
| ------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `outbox_published_total`        | counter | Events confirmed by the broker                                                |
| `outbox_failed_total`           | counter | Failed publish attempts, including ones that end in dead-lettering            |
| `outbox_dead_total`             | counter | Events dead-lettered after `OUTBOX_MAX_ATTEMPTS` failed attempts (default 10) |
| `outbox_pending`                | gauge   | Events neither published nor dead-lettered                                    |
| `outbox_oldest_pending_seconds` | gauge   | Age of the oldest pending event, 0 when none                                  |

### AMQP (core relay and notifications consumers)

| Metric                          | Type      | Labels             | Notes                                     |
| ------------------------------- | --------- | ------------------ | ----------------------------------------- |
| `amqp_messages_total`           | counter   | `queue`, `outcome` | `outcome` = `ack`, `retry`, `dlq`, `drop` |
| `amqp_handler_duration_seconds` | histogram | `queue`            | Buckets 0.005 s to 10 s                   |

Queues seen here: `notifications.events` and `notifications.email` (notifications), `core.realtime-relay` (core). `dlq` only occurs on `notifications.events`; `notifications.email` has no DLQ, so exhausted jobs are `drop`ped after the worker marks them failed. `notifications.events` retries up to 5 attempts, `notifications.email` up to 3.

### Errors (all services)

| Metric         | Type    | Labels                                                          |
| -------------- | ------- | --------------------------------------------------------------- |
| `errors_total` | counter | `source` = `http`, `amqp`, `process`; `type` = error class name |

`source="http"` counts error responses, but each service counts at a different place, so the three do not count exactly the same set:

- **Core and notifications** count in the global `AllExceptionsFilter` (`@repo/shared`), which sees every exception thrown while handling a matched route: domain errors (4xx and 5xx, by class name, e.g. `AccessDeniedError`, mapped by `DomainExceptionFilter`) and everything else, including unhandled exceptions answered with 500 (`TypeError`, ...) and Nest `HttpException`s such as `BadRequestException` from validation or `UnauthorizedException` from guards. Not counted: the `NotFoundException` Nest raises for a request that matches no route (`Cannot GET /x`, a 404 that scanners and typos produce), and `HttpException`s with a status below 400.
- **Auth** counts in its Express error handler, so only errors passed to `next(err)`: domain errors, unhandled exceptions (500) and malformed JSON bodies (400, `SyntaxError`, not logged). Not counted: request-body validation failures (answered 400 without throwing), requests that match no route (Express's default 404) and the internal-token rejections on `/metrics` and `/health/details`.

Every error response, counted or not, still appears in `http_request_errors_total`. Counting never changes the response. `source="amqp"` counts failed message handling (every failed attempt, including poison messages).

`source="process"` (`uncaughtException`, `unhandledRejection`) is best-effort: the handler logs one JSON line to stderr and exits with code 1 right after incrementing, so the increment is almost never scraped. A process crash surfaces as that fatal log line plus `up == 0` (the `ServiceDown` alert) and container restarts, not through this counter.

### Process

Each registry also exposes the prom-client Node default metrics (`process_*`, `nodejs_*`), for example `process_resident_memory_bytes`, which the Grafana dashboard uses.

## 3. Logging

All backends use the shared `WinstonLogger` from `@repo/shared`.

- **Format**: pretty, colourised lines unless `NODE_ENV=production`; one JSON object per line in production (`timestamp`, `level`, `message`, `context`, `correlationId`, `stack` on errors, plus structured data such as `props`).
- **`LOG_LEVEL`**: optional, one of `error`, `warn`, `info`, `debug`, `verbose` (the shared logger's levels). Default `info` in production, `debug` otherwise. An invalid value falls back to the default and logs one warning.
- **Access log**: one line per HTTP response (`context: "AccessLog"`) with method, route template, status and duration in ms. The route template is the same label the HTTP metrics use (one shared helper), captured when the route matches, so responses written by an app-level error handler keep the router prefix (`/auth/login`, not `/login`). Never query strings, bodies, headers or tokens. Status 500 and above is logged at `error`, the rest at `info`. Health and metrics requests are skipped.
- Logs never contain secrets, tokens, cookies or request bodies.
- Fatal process errors are written synchronously as JSON to stderr, then the process exits 1.

### Request ids

Every HTTP request runs inside a request context. The id is the `X-Request-Id` request header when it matches `[A-Za-z0-9._-]{1,128}`, otherwise a fresh UUID. It is echoed on the response in `X-Request-Id`, and every log line written while handling the request carries it as `correlationId`. CORS in all three backends allows the `X-Request-Id` request header and exposes `x-request-id` on responses, so the browser client can both send an id and read the one echoed back.

Over RabbitMQ the same id travels in the `x-correlation-id` message header:

1. Core writes the id of the current request into `outbox_events.correlation_id` with the event.
2. The outbox relay publishes the event to the `innogram.events` exchange with `x-correlation-id`.
3. The notifications consumer reads the header (invalid or missing means a fresh UUID), handles the message inside the same request context, and republishes `notification.created` / `notification.seen` with the same header.
4. Core's `core.realtime-relay` consumer reads it again when relaying to the user's Socket.IO room.

Successful consumer and relay handling logs one `debug` line ending in `(correlationId=<id>)`, so set `LOG_LEVEL=debug` to see the happy path. Failures log at `warn` or `error` with the id.

### Following one request across services

```bash
# 1. Send a request with a known id
curl -s -i -H "X-Request-Id: trace-demo-1" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -X POST http://localhost:3001/follows -H "Content-Type: application/json" -d '{"followingId":"<user-id>"}'

# 2. Search every service's logs for it
docker compose -f docker-compose.yml -f docker-compose.apps.yml --env-file .env.production logs core notifications | grep trace-demo-1          # containers
```

In dev the services run on the host, so grep their terminal or log output instead. With JSON logs, `grep '"correlationId":"trace-demo-1"'` or `jq 'select(.correlationId=="trace-demo-1")'` works. Expect, in order: core's `AccessLog` line, the notifications handler line, and core's relay line. To confirm the id reached the broker, check the `x-correlation-id` header of the message in the RabbitMQ management UI (port 15672) or query `SELECT correlation_id FROM outbox_events ORDER BY "occurredAt" DESC LIMIT 5;`.

## 4. Monitoring stack (Prometheus and Grafana)

Optional, behind the compose profile `monitoring`. Nothing else depends on it.

### Start

Set `GRAFANA_ADMIN_PASSWORD` in the root `.env` (required: the Grafana container refuses to start when it is empty) and make sure `INTERNAL_API_TOKEN` is set (Prometheus uses it to scrape `/metrics`).

```bash
# Dev: the services run on the host; Prometheus scrapes host.docker.internal:3001/3002/3003
docker compose --profile monitoring up -d

# Production stack (apps in containers; the overlay sets PROMETHEUS_TARGETS to core:3001,auth:3002,notifications:3003)
docker compose -f docker-compose.yml -f docker-compose.apps.yml --env-file .env.production --profile monitoring up -d
```

`PROMETHEUS_TARGETS` (optional) overrides the scrape targets: comma-separated `host:port` or `name=host:port`. The `service` label is the name, or derived from the port (3001 core, 3002 auth, 3003 notifications).

### Grafana

- URL: `http://localhost:3030` (container port 3000 published on 3030).
- Login: user `admin`, password = `GRAFANA_ADMIN_PASSWORD`. Anonymous visitors get the read-only Viewer role; sign-up is disabled.
- The Prometheus datasource and the dashboard **Innogram overview** (uid `innogram-overview`, refresh 15 s) are provisioned from `docker/monitoring/grafana/`. It has a `Service` variable (multi-select, default All).

| Panel                              | Shows                                                     |
| ---------------------------------- | --------------------------------------------------------- |
| p95 latency by route               | `http_request_duration_seconds` p95 per service and route |
| Error rate (5xx share of requests) | 5xx requests / all requests per service                   |
| Cache hit ratio (core)             | `cache_requests_total` hits / all, per resource           |
| DB pool connections                | `db_pool_connections` by state                            |
| Process RSS                        | `process_resident_memory_bytes`                           |
| Outbox pending                     | `outbox_pending`, plus dead, published and failed rates   |
| Outbox oldest pending age          | `outbox_oldest_pending_seconds`                           |
| AMQP message outcomes              | `amqp_messages_total` rate by queue and outcome           |
| AMQP handler p95                   | `amqp_handler_duration_seconds` p95 per queue             |
| Errors by source and type          | `errors_total` rate                                       |

### Reaching Prometheus

Prometheus publishes **no host port**, so `http://localhost:9090` does not work. It is reachable on the compose network `innogram-network` only. Options:

```bash
# Alerts and targets without a browser (works everywhere)
docker compose --profile monitoring exec prometheus wget -qO- http://localhost:9090/api/v1/alerts
docker compose --profile monitoring exec prometheus wget -qO- http://localhost:9090/api/v1/targets
docker compose --profile monitoring exec prometheus promtool check rules /etc/prometheus/alerts.yml

# The Prometheus web UI from a Linux host: use the container IP
PROM_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' innogram-prometheus)
echo "http://$PROM_IP:9090"
```

Container IPs are not reachable from the host on Docker Desktop (macOS, Windows); there, use `docker compose exec` as above, or Grafana: open Explore (Prometheus datasource) and query `ALERTS{alertstate="firing"}` or `up{job="innogram"}`. Scrape config is one job, `innogram`, in `docker/monitoring/prometheus.yml` (15 s interval, targets from file_sd).

## 5. Alerts

Rules live in `docker/monitoring/alerts.yml`, evaluated every 15 s. **There is no Alertmanager**: nothing sends email, chat or pages. An alert is visible only in the Prometheus UI (Alerts page, states `pending` then `firing`), at `/api/v1/alerts`, or as the `ALERTS` series in Grafana. Someone has to look.

| Alert             | Severity | Condition                                                                    | For  |
| ----------------- | -------- | ---------------------------------------------------------------------------- | ---- |
| `ServiceDown`     | critical | `up{job="innogram"} == 0`                                                    | 1m   |
| `High5xxRate`     | critical | 5xx share of requests per service above 5% (5m rate)                         | 5m   |
| `HighP95Latency`  | warning  | p95 request latency per service above 0.5 s                                  | 10m  |
| `OutboxBacklog`   | warning  | `outbox_oldest_pending_seconds > 300`                                        | none |
| `OutboxDead`      | critical | `increase(outbox_dead_total[15m]) > 0`                                       | none |
| `AmqpDlqGrowth`   | critical | `amqp_messages_total{outcome="dlq"}` increased in 15m, per service and queue | none |
| `DbPoolSaturated` | warning  | `db_pool_connections{state="waiting"} > 0`                                   | 5m   |

### Runbook

**`ServiceDown`**: Prometheus cannot scrape the target.

1. `curl http://localhost:<port>/health` (3001 core, 3002 auth, 3003 notifications). No answer means the process is down; `docker compose -f docker-compose.yml -f docker-compose.apps.yml --env-file .env.production ps` / `… logs <service>` in containers, the service's terminal in dev.
2. If the service answers `/health` but the scrape fails, check `INTERNAL_API_TOKEN` is identical for the service and Prometheus (a 401 on `/metrics`), and the `PROMETHEUS_TARGETS` host and port. `/api/v1/targets` shows `lastError`.
3. Startup failures are usually env validation: the log names the missing or invalid variable (see `docs/ENVIRONMENT.md`).

**`High5xxRate`**: more than 5% of a service's requests fail with 5xx.

1. Panels "Error rate" and "Errors by source and type" show the affected service and error class (`errors_total{source="http",type=...}`, which includes unexpected exceptions; see Errors above for what each service counts).
2. `curl -H "X-Internal-Token: $TOKEN" .../health/details` for a `down` dependency (database, Redis, broker).
3. Find a failing request in the logs (`AccessLog` lines with status 5xx at `error` level) and follow its `correlationId`; the stack is logged next to it.

**`HighP95Latency`**: p95 above 500 ms for 10 minutes.

1. "p95 latency by route" tells you which route. Compare with `db_queries_per_request` (core) for N+1 patterns, and "DB pool connections" for waiting requests.
2. Check `cache_requests_total{result="error"}` (a failing cache turns hits into database reads) and the dependency `latencyMs` in `/health/details`.

**`OutboxBacklog`**: the oldest event has waited over 5 minutes, so notifications and realtime updates are late. Core is writing events faster than it can publish, or the broker is unreachable.

1. `/health/details` on core: is `broker` down? Is RabbitMQ up (`docker compose ps rabbitmq`, management UI on port 15672)?
2. `outbox_failed_total` rising means publishes are failing; the core log has the reason. The relay backs off and recovers by itself when the broker returns, and `outbox_pending` should then drain to 0.

**`OutboxDead`**: events were dead-lettered after `OUTBOX_MAX_ATTEMPTS` failures. They are skipped and never purged, so those notifications will not arrive until requeued.

1. Read the reason: `SELECT id, "routingKey", attempts, "lastError" FROM outbox_events WHERE "deadLetteredAt" IS NOT NULL ORDER BY "deadLetteredAt" DESC;` in the `innogram_core` database.
2. Fix the cause (for example a broker-side rejection), then requeue by hand: `UPDATE outbox_events SET "deadLetteredAt" = NULL, attempts = 0 WHERE ...;`. The relay picks them up again.

**`AmqpDlqGrowth`**: messages exhausted their retries (5 attempts) or were poison (invalid payload, no handler) and moved to `notifications.events.dlq`.

1. Open the queue in the RabbitMQ management UI (port 15672). Each message carries `x-last-error`, `x-original-routing-key` and `x-attempts` headers, and `x-correlation-id` to find the originating request in the logs.
2. Fix the handler or the data, then republish or discard the messages. Nothing consumes the DLQ automatically.

**`DbPoolSaturated`**: requests have waited for a database connection for 5 minutes.

1. "DB pool connections" shows `total`, `idle` and `waiting` per service.
2. Look for slow queries or a request that holds a connection (high `db_queries_per_request`, slow routes in "p95 latency by route"), and for a database that is itself overloaded. Restarting the service clears a leak only temporarily.
