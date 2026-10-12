# Quickstart: Client Application Baseline

Validation guide for `001-client-app-baseline`. Proves each user story / success criterion end-to-end without reproducing implementation code. Contract shapes are referenced from [contracts/](./contracts/README.md); data concepts from [data-model.md](./data-model.md).

## Prerequisites

- Node 20, npm (monorepo uses npm workspaces + Turborepo).
- PostgreSQL + Redis running (`npm run docker:up`).
- A seeded backend with at least one registered user and at least one published post. Registration is available at `POST /auth/register`; profile creation is fire-and-forget on registration (see `DDD_ARCHITECTURE_GUIDE.md` §6).
- Root `.env` present (`cp .env.example .env`) with the client's `CLIENT_PORT` (default `3000`) and service URLs set.

## One-time setup

```bash
# from repo root
npm install
cp .env.example .env                       # then review values
npm run docker:up                          # Postgres + Redis
npm run migration:run -w core_microservice
npm run migration:run -w auth_microservice
```

> The client's `build`/`dev` depends on `@repo/contracts` being built (`turbo run` handles this via `^build`; standalone runs need `npm run build -w @repo/contracts` first).

## Scenario 1 — App boots and renders (US-1, FR-001, FR-002, SC-001, SC-002)

```bash
npm run dev
# open http://localhost:3000
```

**Expected**: the Innogram home screen renders with visible branding and a content area in under 3 s.

**Viewport check (SC-004, FR-011)**: resize to desktop (~1280px), tablet (~768px), mobile (~375px). The shell and navigation remain usable at each size.

## Scenario 2 — Navigation shell (US-2, FR-003, FR-004, SC-003)

**Given** the home screen is displayed, **When** you select `Profile` (then `Home`) from the navigation element, **Then** the corresponding section renders inside the shared layout without re-entering the app address. Verify both primary destinations are reachable (100% — SC-003).

## Scenario 3 — Unknown destination (FR-005)

Navigate to `http://localhost:3000/does-not-exist`. **Expected**: a friendly "not found" screen (not a blank/broken page).

## Scenario 4 — Login + authenticated data (US-3, FR-006, FR-012, FR-013, SC-007)

1. Navigate to the login flow (`/login`).
2. Submit valid credentials for a seeded user.
3. **Expected**: the app obtains `{ accessToken, refreshToken, user }` from `POST /auth/login` (shape in [auth.md](./contracts/auth.md)) and transitions to `signedIn`.
4. Open **Profile** (`/profile`). **Expected**: the signed-in user's own profile (`displayName`, `username`, `bio`, `avatarUrl`) is displayed — fetched via `GET /profiles/me` using the JWT `sub` (shape in [profile.md](./contracts/profile.md)).
5. Open **Home** (`/`). **Expected**: feed posts are displayed — fetched via `GET /posts/feed` with the `Authorization: Bearer` header (shape in [feed.md](./contracts/feed.md), `items` array).

## Scenario 5 — Backend unavailable → error/retry → auto-recovery (FR-007, SC-005)

1. Stop the core service (`Ctrl-C` on its process, or stop the container).
2. Open **Home**. **Expected**: a friendly error/retry state; the app does **not** crash.
3. Restart the core service. **Expected**: without reloading or restarting the client, the feed re-fetches (interval re-attempt), the error state clears, and posts render again.

## Scenario 6 — Build artifact (FR-010, SC-006)

```bash
npm run build        # or: npm run build -w client_app
```

**Expected**: the deployable build is produced through the standard monorepo workflow with no manual intervention.

## Scenario 7 — Boundary checks (FR-008, FR-009, constitution III)

- Confirm the client reads its own config from the root `.env` (distinct `CLIENT_PORT`; service URLs via `NEXT_PUBLIC_*`).
- Confirm no backend secret (`JWT_SECRET`, DB/Redis/SMTP/S3) appears in the client bundle or `NEXT_PUBLIC_*` config.
- Confirm `apps/client_app` imports only `@repo/contracts` (grep for `@repo/shared` → zero matches).

## Scenario 8 — Quality gates

```bash
npm run lint        # or: npm run lint -w client_app
npm run test        # or: npm run test -w client_app   (component/unit specs)
npm run build       # type-check surrogate via tsc
```

**Expected**: lint, unit tests, and build all pass.
