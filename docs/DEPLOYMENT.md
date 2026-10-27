# Deployment

How to run Innogram as containers: the images, the production-style env file, the start order, upgrades and rollback, and monitoring. The target is a single Docker host driven by `docker-compose.yml` plus the `docker-compose.apps.yml` overlay. There is no cloud or PaaS target.

Related docs: [docs/ENVIRONMENT.md](ENVIRONMENT.md) (every variable), [docs/OBSERVABILITY.md](OBSERVABILITY.md) (logs, metrics, alerts), [docs/API.md](API.md) (Swagger and the HTTP surface), [README.md](../README.md) (local development).

In the commands below, `$COMPOSE` stands for the exact command behind `npm run docker:apps:up`, minus `up -d --build`:

```bash
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.apps.yml --env-file .env.production"
```

## What runs

| Layer                                 | Services                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure (`docker-compose.yml`) | `postgres` (three databases), `redis`, `redis-cache`, `rabbitmq`, `mailpit`, `seaweedfs`, `seaweedfs-setup` (one-shot, creates the buckets) |
| Migrate jobs (overlay, one-shot)      | `auth-migrate`, `core-migrate`, `notifications-migrate`                                                                                     |
| Apps (overlay)                        | `auth` (3002), `core` (3001), `notifications` (3003), `client` (3000)                                                                       |
| Monitoring (profile `monitoring`)     | `prometheus`, `grafana`                                                                                                                     |

## Images

Each app has a multi-stage Dockerfile at `apps/<app>/Dockerfile`. The build context is always the repo root.

| Image         | Dockerfile                                            | Local tag (compose)            | Published by CI                          |
| ------------- | ----------------------------------------------------- | ------------------------------ | ---------------------------------------- |
| auth          | `apps/auth_microservice/Dockerfile`                   | `innogram-auth:local`          | `ghcr.io/<owner>/innogram-auth`          |
| core          | `apps/core_microservice/Dockerfile`                   | `innogram-core:local`          | `ghcr.io/<owner>/innogram-core`          |
| notifications | `apps/notifications_consumer_microservice/Dockerfile` | `innogram-notifications:local` | `ghcr.io/<owner>/innogram-notifications` |
| client        | `apps/client_app/Dockerfile`                          | `innogram-client:local`        | `ghcr.io/<owner>/innogram-client`        |

The backend images run as the non-root `node` user, contain `dist/` plus production dependencies only, and have a `HEALTHCHECK` on `/health`. The client is a Next.js standalone server. The migrate jobs reuse the auth, core and notifications images and run `node dist/migrate.js`.

### Where CI publishes them

`.github/workflows/docker-images.yml` builds all four images in a matrix.

- Pull requests: build only, nothing is pushed.
- Push to `main`: pushes `sha-<short sha>` and `latest`.
- Push of a `v*` tag (for example `v1.2.0`): pushes `sha-<short sha>`, `1.2.0` and `1.2`.
- `<owner>` is the repository owner, lowercased. The workflow logs in to GHCR with `GITHUB_TOKEN`. If the package is private, run `docker login ghcr.io` on the host before pulling.

### The client image bakes in its URLs

`NEXT_PUBLIC_*` values are compiled into the browser bundle by `next build`, so the client is configured at image build time, not at run time. The Dockerfile takes the build args `AUTH_SERVICE_URL`, `CORE_SERVICE_URL`, `NOTIFICATIONS_SERVICE_URL` (and optionally `GOOGLE_CLIENT_ID`); `next.config.ts` maps them to `NEXT_PUBLIC_*`, and the production build fails if one of the three URLs is missing. They must be reachable from the user's browser (public hostnames or published host ports), never container names.

- CI builds the client with the repository variables `AUTH_SERVICE_URL`, `CORE_SERVICE_URL` and `NOTIFICATIONS_SERVICE_URL` (Settings, Secrets and variables, Actions, Variables), falling back to `http://localhost:3002`, `:3001` and `:3003`. Without those variables the published `innogram-client` image only works for the compose default URLs (everything on `localhost`).
- For any other environment, rebuild the client with your own URLs. With compose, set `CLIENT_PUBLIC_AUTH_URL`, `CLIENT_PUBLIC_CORE_URL` and `CLIENT_PUBLIC_NOTIFICATIONS_URL` in `.env.production`; the overlay passes them as the build args. Changing them requires a rebuild (`npm run docker:apps:up` already builds).

### Building locally

```bash
# All four images, tagged innogram-<name>:local (what docker:apps:up does)
$COMPOSE build

# One image by hand
docker build -f apps/core_microservice/Dockerfile -t innogram-core:local .
docker build -f apps/client_app/Dockerfile \
  --build-arg AUTH_SERVICE_URL=https://auth.example.com \
  --build-arg CORE_SERVICE_URL=https://api.example.com \
  --build-arg NOTIFICATIONS_SERVICE_URL=https://notifications.example.com \
  -t innogram-client:local .
```

## Configure `.env.production`

```bash
cp .env.production.example .env.production      # gitignored
```

Replace every `CHANGE_ME`. Generate each secret with `openssl rand -hex 32` (64 hex characters; safe inside the `RABBITMQ_URL`):

| Variable                           | Notes                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                | Used only when the Postgres volume is first created; see Troubleshooting        |
| `RABBITMQ_DEFAULT_PASS`            | Must also appear inside `RABBITMQ_URL` (`amqp://innogram:<pass>@rabbitmq:5672`) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | 32+ characters, different from each other                                       |
| `INTERNAL_API_TOKEN`               | 32+ characters, the same value for all services                                 |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`   | SeaweedFS S3 credentials                                                        |
| `GRAFANA_ADMIN_PASSWORD`           | Required only with the monitoring profile                                       |

With `NODE_ENV=production` the three services refuse to start while `JWT_SECRET`, `JWT_REFRESH_SECRET` or `INTERNAL_API_TOKEN` still contain `CHANGE_ME` or are too short. Core also refuses to start with `PERF_INSTRUMENTATION=true`, so keep it `false`.

Then set the environment-specific values:

- `CLIENT_URL` and `AUTH_ALLOWED_ORIGINS`: the browser origin of the client (CORS, cookie credentials, links in emails).
- `CLIENT_PUBLIC_*_URL` and `S3_PUBLIC_ENDPOINT`: browser-reachable URLs of the apps and of the S3 port (see above).
- `SMTP_*`: point at a real SMTP provider. `mailpit` still starts because the apps wait for it, but it only catches mail.
- `AUTH_COOKIE_SAMESITE`: keep the default `strict` while client and auth share a site; `none` needs HTTPS on auth.

`.env.production` is used twice: as `env_file` for the backends and their migrate jobs, and through `--env-file` for interpolating `docker-compose.yml` (the infra credentials). The root `.env` is not read by these commands. The full variable reference is [docs/ENVIRONMENT.md](ENVIRONMENT.md).

## Start

```bash
npm run docker:apps:up
```

This is `docker compose -f docker-compose.yml -f docker-compose.apps.yml --env-file .env.production up -d --build`. Compose starts things in this order, enforced by `depends_on`:

1. `postgres`, `redis`, `redis-cache`, `rabbitmq`, `mailpit` and `seaweedfs` start and must become healthy.
2. `seaweedfs-setup` creates the missing buckets and exits 0.
3. `auth-migrate`, `core-migrate` and `notifications-migrate` wait for a healthy Postgres, apply pending migrations and exit 0 (they exit 0 as well when nothing is pending, and run again on every `up`).
4. `auth` and `core` start once the infrastructure is ready and all three migrate jobs have exited 0. `notifications` additionally waits for `auth` to be healthy (it calls auth's internal contact endpoint).
5. `client` starts when `auth`, `core` and `notifications` are healthy.

If a migrate job fails, the apps never start; read its logs (`$COMPOSE logs core-migrate`).

Check the result:

```bash
$COMPOSE ps                         # every long-running service should be (healthy)
curl -fsS http://localhost:3002/health
curl -fsS http://localhost:3001/health
curl -fsS http://localhost:3003/health
curl -fsSI http://localhost:3000/   # client
```

Stop the stack without touching data:

```bash
npm run docker:apps:down            # no -v: volumes (databases, uploads) are kept
```

### Ports

The compose files publish these host ports:

| Port                                      | Service                                                               | Notes                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 3000, 3001, 3002, 3003                    | client, core, auth, notifications                                     | Public entry points                                                                     |
| 9000                                      | SeaweedFS S3                                                          | Browsers upload and download through it, so it must be reachable (`S3_PUBLIC_ENDPOINT`) |
| 5432, 6379, 6380, 5672, 15672, 1025, 8025 | Postgres, Redis, redis-cache, RabbitMQ (AMQP, UI), Mailpit (SMTP, UI) | Published by `docker-compose.yml` for local development                                 |
| 3030                                      | Grafana (monitoring profile)                                          |                                                                                         |

In a real deployment, firewall everything except the four app ports and 9000, or remove the infra `ports:` entries in an override file. **Port 3012 is auth's internal listener (`/internal/users/:id/contact`, guarded by `X-Internal-Token`). It is never published and must never be exposed publicly**; notifications reaches it over the compose network through `AUTH_INTERNAL_URL=http://auth:3012`. `/health/details` and `/metrics` on the app ports also require `X-Internal-Token`. TLS is not part of the stack: terminate it in a reverse proxy in front of the four app ports (cross-site refresh cookies need HTTPS, see `AUTH_COOKIE_SAMESITE`).

Swagger UI is off by default when `NODE_ENV=production`; set `SWAGGER_ENABLED=true` to serve it (see [docs/API.md](API.md)).

## Monitoring (optional)

Prometheus and Grafana sit behind the `monitoring` profile. Use the same compose command with the profile and without `--build`:

```bash
$COMPOSE --profile monitoring up -d
```

The overlay points Prometheus at `core:3001,auth:3002,notifications:3003`, and it authenticates scrapes with `INTERNAL_API_TOKEN`. Grafana runs on <http://localhost:3030> (anonymous viewers; sign in as `admin` with `GRAFANA_ADMIN_PASSWORD` to edit) with the Prometheus data source and dashboards provisioned. Dashboards, metrics and alerts are described in [docs/OBSERVABILITY.md](OBSERVABILITY.md).

### Reaching Prometheus

Prometheus has no host port. Grafana reaches it inside the network at `http://prometheus:9090`. Options:

- Use Grafana: its Explore view queries Prometheus directly.
- Query it from inside the container (the image ships BusyBox `wget`):

  ```bash
  $COMPOSE exec prometheus wget -qO- http://localhost:9090/-/healthy
  $COMPOSE exec prometheus wget -qO- http://localhost:9090/api/v1/targets
  $COMPOSE exec prometheus wget -qO- http://localhost:9090/api/v1/alerts
  ```

- Publish a port with an extra compose file. Save this as `docker-compose.prometheus-port.yml` (not part of the repo) and add `-f docker-compose.prometheus-port.yml` after the overlay in the compose command:

  ```yaml
  services:
    prometheus:
      ports:
        - "127.0.0.1:9090:9090"
  ```

  Bind to `127.0.0.1` (or reach it over an SSH tunnel). The UI has no authentication.

`npm run docker:apps:down` does not include the profile. To stop the monitoring containers as well, run `$COMPOSE --profile monitoring down` (still without `-v`).

## Upgrading

1. Back up the databases (migrations are forward-only unless reverted, so keep a restore point):

   ```bash
   $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$DB_NAME_AUTH"' > auth.sql
   $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$DB_NAME_CORE"' > core.sql
   $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$DB_NAME_NOTIFICATIONS"' > notifications.sql
   ```

2. Tag the images you are running so you can roll back to them: `docker tag innogram-core:local innogram-core:previous` (repeat for auth, notifications, client).
3. Get the new code (`git pull`) and compare `.env.production` with `.env.production.example` for new variables.
4. Run `npm run docker:apps:up`. It rebuilds the images, the migrate jobs run first, and compose recreates only the containers whose image or configuration changed.
5. Check `$COMPOSE ps` and the `/health` endpoints as above.

To deploy published images instead of building on the host, override the `image:` of each service (and its migrate job) with a CI tag in an extra compose file (for example `core` and `core-migrate` both `ghcr.io/<owner>/innogram-core:1.2.0`), run `$COMPOSE -f <that file> pull`, then `up -d` without `--build`. Remember that the published client image only fits the URLs it was built with.

## Rollback

Pin images by tag, never by `latest`.

1. Point the services (and migrate jobs) at the previous tags: either the `:previous` tags from the upgrade step, or earlier CI tags such as `ghcr.io/<owner>/innogram-core:sha-<short sha>` or `:1.1.0`, through an extra compose file as above.
2. `$COMPOSE -f <that file> up -d` (no `--build`).
3. Migrations are not undone by switching images. If the release added a migration and the older code cannot run against the new schema, either restore the pre-upgrade dump or revert the migration with the TypeORM CLI from a source checkout of the matching version:

   ```bash
   cd apps/core_microservice && npm run migration:revert   # also in auth_microservice and notifications_consumer_microservice
   ```

   `migration:revert` undoes one migration per call and connects through the root `.env` of that checkout (`POSTGRES_HOST`, `POSTGRES_PORT`, `DB_NAME_*`; the published port 5432 is reachable on the host). Check those values point at the right database before running it. The container images do not include the CLI.

## Troubleshooting

- **An app container exits at start-up**: `$COMPOSE logs <service>`. Typical causes are a `CHANGE_ME` or short secret, a missing required variable (the error names it), or `PERF_INSTRUMENTATION=true`.
- **`up` fails on a migrate job**: `$COMPOSE logs core-migrate` (or auth, notifications). The apps start only after all three exit 0.
- **`password authentication failed` from the migrate jobs on a host that already ran the dev stack**: Postgres only reads `POSTGRES_PASSWORD` when its volume is first created. Either put the same password in `.env.production` that the existing volume was created with, or use a fresh Docker project (below).
- **Containers keep a fixed name** (`innogram-postgres`, and so on), so two compose projects cannot run side by side, and the apps' host ports 3000-3003 clash with `npm run dev`. Stop the dev servers before `docker:apps:up`.
- **Existing dev stacks only get the new healthchecks after the containers are recreated.** The overlay waits on `condition: service_healthy` of the infrastructure. If `$COMPOSE ps` or `docker compose ps` shows no `(healthy)` next to postgres, redis, redis-cache, rabbitmq, mailpit or seaweedfs, run `docker compose up -d` (`npm run docker:up`) once. It recreates the changed containers; named volumes and their data are kept. Never add `-v` or `down -v` to that.
- **The browser calls `localhost` URLs, or CORS/cookie errors appear**: the client image was built with the wrong URLs, or `CLIENT_URL` and `AUTH_ALLOWED_ORIGINS` do not match the browser origin. Fix `.env.production` and rebuild the client.
- **Uploaded images do not load**: `S3_PUBLIC_ENDPOINT` must be a URL the browser can reach (host port 9000 or your public S3 hostname).
- **Notifications stay unhealthy**: they need auth healthy and the same `INTERNAL_API_TOKEN` as auth; check `AUTH_INTERNAL_URL`.

### Starting over

`docker compose down -v` permanently deletes the Postgres, Redis, SeaweedFS, Prometheus and Grafana volumes. **Never run it against the default project on a machine that holds development data you want to keep.** To test a deployment from scratch, use a separate project name with the dev stack stopped, and reset only that project:

```bash
docker compose -p innogram-verify -f docker-compose.yml -f docker-compose.apps.yml --env-file .env.production down -v
```
