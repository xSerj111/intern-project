# client_app

Innogram web client (Next.js App Router, React 19). It talks to the auth, core and notifications services directly over HTTP and Socket.IO, and imports only `@repo/contracts` (never `@repo/shared`).

Environment variables are listed in [docs/ENVIRONMENT.md](../../docs/ENVIRONMENT.md).

## Run

Run from the repo root to start every app through Turborepo, or target this app with `-w client_app`:

```bash
npm run dev -w client_app          # next dev on CLIENT_PORT (default 3000)
npm run build -w client_app        # next build, standalone output
npm run start -w client_app        # next start after a build, same port
npm run lint:check -w client_app   # read-only ESLint
npm run type-check -w client_app   # tsc --noEmit
npm run test -w client_app         # jest (no unit specs yet, passes with none)
```

The backend services must be running for the app to work: `npm run docker:up`, then the services (`npm run dev` at the root, or the service dev scripts). Build `@repo/contracts` first when running this app standalone: `npm run build -w @repo/contracts`.

## Environment

`next.config.ts` loads the repo-root `.env` and maps these server-side values to browser-visible `NEXT_PUBLIC_*` values at build time. Do not set `NEXT_PUBLIC_*` in `.env`.

| Variable                    | Used for                                                 | Default                        |
| --------------------------- | -------------------------------------------------------- | ------------------------------ |
| `AUTH_SERVICE_URL`          | Auth API base URL (sent with cookies)                    | `http://localhost:3002` in dev |
| `CORE_SERVICE_URL`          | Core API base URL                                        | `http://localhost:3001` in dev |
| `NOTIFICATIONS_SERVICE_URL` | Notifications API base URL                               | `http://localhost:3003` in dev |
| `CLIENT_PORT`               | Port for `dev` and `start`                               | `3000`                         |
| `GOOGLE_CLIENT_ID`          | Google sign-in button (public client id, not the secret) | empty: the button is disabled  |

- **Build time.** `NEXT_PUBLIC_*` values are inlined into the bundle. Changing a service URL needs a rebuild (`npm run build`) or a dev-server restart.
- **Production build.** `next build` with `NODE_ENV=production` fails when one of the three `*_SERVICE_URL` values is missing, so a production bundle never ships localhost URLs. In development it warns and falls back to the localhost defaults.
- **Browser reachability.** These URLs are used from the user's browser, so they must be the host-published addresses of the services, not container names.

## Docker image

`apps/client_app/Dockerfile` builds a standalone Next.js server on port `3000`. Build from the repo root:

```bash
docker build -f apps/client_app/Dockerfile \
  --build-arg AUTH_SERVICE_URL=http://localhost:3002 \
  --build-arg CORE_SERVICE_URL=http://localhost:3001 \
  --build-arg NOTIFICATIONS_SERVICE_URL=http://localhost:3003 \
  --build-arg GOOGLE_CLIENT_ID=your-google-client-id \
  -t innogram-client:local .
```

| Build arg                   | Required | Notes                                                            |
| --------------------------- | -------- | ---------------------------------------------------------------- |
| `AUTH_SERVICE_URL`          | Yes      | Baked into the bundle as `NEXT_PUBLIC_AUTH_SERVICE_URL`          |
| `CORE_SERVICE_URL`          | Yes      | Baked into the bundle as `NEXT_PUBLIC_CORE_SERVICE_URL`          |
| `NOTIFICATIONS_SERVICE_URL` | Yes      | Baked into the bundle as `NEXT_PUBLIC_NOTIFICATIONS_SERVICE_URL` |
| `GOOGLE_CLIENT_ID`          | No       | Empty disables Google sign-in                                    |

The image reads no service URL at runtime. The published image (`ghcr.io/<owner>/innogram-client`, built by CI) therefore only works with the compose default URLs. Any other environment rebuilds it with its own build args.

With `docker-compose.apps.yml`, the build args come from the compose-level variables `CLIENT_PUBLIC_AUTH_URL`, `CLIENT_PUBLIC_CORE_URL`, `CLIENT_PUBLIC_NOTIFICATIONS_URL` and `GOOGLE_CLIENT_ID` in `.env.production` (defaults `http://localhost:3002`, `http://localhost:3001`, `http://localhost:3003`). See [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## E2E

Browser tests use Playwright (Chromium only) and live in `e2e/`.

Prerequisites:

- The full stack and the client are already running (`npm run docker:up`, then `npm run dev`). The config has no `webServer`, so Playwright never starts anything.
- `CLIENT_URL` points at the client (default `http://localhost:3000`).
- Chromium is installed once with `npx playwright install chromium`.

Run from the repo root:

```bash
npm run e2e                       # all flows
npm run e2e -- --repeat-each=3    # flakiness check
npm run e2e -- --headed -g "chat" # pass any Playwright flag after `--`
```

Failed tests keep a trace and screenshot in `e2e/.artifacts/` (gitignored). Open a trace with:

```bash
npx playwright show-trace e2e/.artifacts/<test-dir>/trace.zip
```

The HTML report lands in `playwright-report/` (gitignored). E2E is not run in CI; run it locally before a release.
