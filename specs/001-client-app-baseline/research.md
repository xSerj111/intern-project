# Research: Client Application Baseline

**Feature**: `001-client-app-baseline` | **Date**: 2026-09-23

Phase 0 output. Every "NEEDS CLARIFICATION" from the Technical Context is resolved here as a Decision / Rationale / Alternatives record. This file is the evidence base for the design in [data-model.md](./data-model.md) and [contracts/](./contracts/README.md).

---

## 1. Frontend framework

**Decision**: Next.js 15 (App Router) + React 19, TypeScript 5.

**Rationale**:
- The repo already declares the client as "Next.js frontend" (`README.md`), and the existing stub `apps/client_app/tsconfig.json` is already wired for Next (`"jsx": "preserve"`, `"plugins": [{ "name": "next" }]`, includes `.next/types/**/*.ts`).
- App Router gives file-based routing that maps directly to the baseline's navigation sections (Home/Feed, Profile, login, not-found) with a shared root layout — exactly the "Application Shell" entity in the spec.
- Node 20 is the monorepo baseline; Next 15 targets it.

**Alternatives considered**:
- *Vite + React SPA*: lighter, but abandons the repo's declared Next direction and requires hand-rolling routing/CSS.
- *Remix / Astro*: viable but no repo signal; Next is the documented choice.
- *Next 14 + React 18*: safe fallback if a dependency forces it, but no reason to pin behind current stable.

---

## 2. Resolving "my profile" (FR-013) — backend gap

**Finding**: The client authenticates and obtains a JWT whose `sub` is the auth user id. A profile is a separate entity (`UserProfile`) keyed by its own UUID `id`, with a distinct `authUserId` column. The only profile read route is `GET /profiles/:id` (profile UUID), and there is no list route. Therefore the client cannot discover "my profile" from the JWT alone.

**Decision**: Add a minimal, read-only `GET /profiles/me` endpoint to `core_microservice`, guarded by the existing `JwtAuthGuard`, resolving the caller's profile via the repository's existing `findByAuthUserId(authUserId)` and returning the existing `ProfileResponseDto`.

**Rationale**:
- This is the smallest possible change that satisfies the spec's clarification ("Profile fetches the signed-in user's own profile using their JWT user ID").
- The repository method already exists (`UserProfileRepository.findByAuthUserId`); only the controller route is missing.
- Read-only + ownership-by-construction (the `sub` determines the profile) means no new IDOR surface: a caller can only ever fetch their own profile.
- No schema change, no migration, no new dependency.

**Alternatives considered**:
- `GET /profiles/by-auth-user/:authUserId`: more generic but introduces an IDOR-adjacent surface (any caller could probe others' `authUserId`s) that would need explicit ownership/visibility rules — rejected as over-broad for the baseline.
- Have the client use `authUserId` as the profile id: rejected — the two are distinct columns; `GET /profiles/:id` looks up by profile UUID and would 404.
- Defer Profile data: rejected — contradicts the "Show my profile" clarification and SC-007.

---

## 3. Feed endpoint auth gap (FR-006)

**Finding**: `GET /posts/feed` builds a personalized feed (`findFollowing(userId)` + own posts). The controller reads `@CurrentUser('sub') userId` but is **not** decorated with `@UseGuards(JwtAuthGuard)`, so `request.user` is `undefined` and `userId` is `undefined` — the feed returns no posts for an authenticated user.

**Decision**: Add `@UseGuards(JwtAuthGuard)` to the existing `GET /posts/feed` handler. No other change (no schema, no service change).

**Rationale**: FR-006 requires "feed posts on Home" and FR-013 requires attaching the JWT to backend requests; a personalized feed cannot work without the authenticated id. This is a one-line additive guard consistent with how `createPost`/`updatePost`/`deletePost` are already guarded.

**Alternatives considered**:
- Treat the feed as public (list all published posts): rejected — contradicts the existing personalized-feed implementation and the follow-based semantics.
- Leave as-is and display a placeholder: rejected — fails FR-006/SC-001 acceptance.

---

## 4. Shared contracts — posts and auth do not exist yet

**Finding**: `@repo/contracts` currently exports `common`, `profiles`, `follows`, `chats`. There is **no** `posts` or `auth` contract. The feed/post response shape lives in `core_microservice`'s `PostResponseDto`, and the login response shape in `auth_microservice`'s `LoginResult`. Per constitution III, the client must not import backend-only code (`@repo/shared`) and must not duplicate wire shapes, so these contracts must be added to `@repo/contracts`.

**Decision**: Add `posts` and `auth` contract modules to `@repo/contracts` (zero-dependency interfaces), and have the existing backend DTOs `implements` them (matching the `ProfileResponseDto implements IProfileResponse` precedent). The client imports only `@repo/contracts`.

**Rationale**: This is the constitution-mandated boundary. The existing `IProfileResponse` already demonstrates the exact pattern (backend DTO implements a contracts interface).

**Alternatives considered**:
- Inline duplicate types in the client: rejected — violates the "no duplicating wire shapes" assumption and constitution III.
- Move only types the client needs: partial adoption, but leaving the backend DTOs unlinked risks drift; full linking is low-cost and the documented convention.

**Note (feed envelope)**: `GET /posts/feed` returns `{ items, total, page, limit }` — it uses `items`, **not** the `data` field of the generic `IPaginatedResponse<T>`. The feed contract therefore models `items`, and the client must read `items` (documented in [contracts/feed.md](./contracts/feed.md)).

---

## 5. Data fetching, error/retry (FR-007, SC-005)

**Decision**: TanStack Query (React Query) v5 for the feed and profile queries, configured with `retry` + `refetchInterval` (interval re-attempt while in error state) and an `isError`/`isFetching` UI state.

**Rationale**: FR-007 requires "show an error/retry state, automatically re-attempt on an interval, and clear the error state once the service responds again — without a restart." TanStack Query provides all three primitives out of the box (`retry`, `refetchInterval`, automatic `status` transitions on success), plus request caching and loading states.

**Alternatives considered**:
- *SWR*: equally valid and lighter; `refreshInterval` + `errorRetryInterval` cover the requirement, but its conditional-interval-error-retry is slightly less explicit than TanStack Query's `retry` + `refetchInterval`. Either is acceptable; TanStack Query chosen for first-class retry semantics.
- *Hand-rolled `setInterval` + state*: more code to maintain and test; rejected.

---

## 6. Auth state and token storage (FR-012, FR-013)

**Decision**: A minimal React Context `AuthProvider` holds `{ accessToken, refreshToken, user }`. On login (`POST /auth/login`), the response is stored in `localStorage` and re-hydrated on app load. The typed HTTP client reads the token from the context and attaches `Authorization: Bearer <accessToken>` to feed/profile requests.

**Rationale**: The backend login returns `{ accessToken, refreshToken, user }` in the JSON body (no httpOnly cookie is set server-side), so client-side storage is required. `localStorage` is the simplest baseline persistence that survives a page reload.

**Security note (documented, not a blocker)**: `localStorage` is readable by any script in the same origin, so it carries an XSS-exposure tradeoff. The baseline accepts this (no user-generated rich content is rendered). A future hardening path is an httpOnly-cookie session via a server-side proxy/route handler; this is recorded in [data-model.md](./data-model.md) and left for a later feature.

**Alternatives considered**:
- *In-memory only (no persistence)*: avoids the XSS tradeoff but forces re-login on every reload — poor UX for the baseline.
- *httpOnly cookie via Next route handlers / server proxy*: more secure but adds a proxy layer and contradicts the backend's existing CORS-for-browser-direct-access setup (`origin: CLIENT_URL, credentials: true`), which signals browser-direct access is the intended pattern. Deferred.
- *Zustand / Redux*: overkill for two authenticated queries; React Context suffices.

---

## 7. Client configuration (FR-008, FR-009)

**Decision**: The client reads the shared root `.env` at build/dev time via `dotenv` in `next.config.ts`, and exposes only browser-safe values through `NEXT_PUBLIC_*`: `NEXT_PUBLIC_AUTH_SERVICE_URL` (from `AUTH_SERVICE_URL`) and `NEXT_PUBLIC_CORE_SERVICE_URL` (from `CORE_SERVICE_URL`). The dev server port comes from a distinct `CLIENT_PORT` (default `3000`, matching `CLIENT_URL`).

**Rationale**:
- FR-008: same root `.env` (the project's single configuration mechanism), with client-distinct values (`CLIENT_PORT`) and no collision with backend `*_PORT` vars.
- FR-009: only service URLs are browser-visible; `JWT_SECRET`, DB, Redis, SMTP, S3 values are never prefixed `NEXT_PUBLIC_` and never reach the client bundle. The JWT itself is obtained at runtime via login, never from config.

**Alternatives considered**:
- *Per-app `.env.local` in `apps/client_app`*: works but breaks the "single root `.env`" convention (constitution I / AGENTS.md). Rejected.
- *Server-side proxy to avoid exposing service URLs*: URLs are not secrets; exposing them is acceptable and matches the backend CORS config. A proxy adds latency and complexity for no security gain here.

---

## 8. Responsive shell (FR-011, SC-004)

**Decision**: CSS Modules (Next.js built-in, zero extra deps) for layout and components, using fluid/container layouts and mobile-first media queries for the header + navigation (collapse to a simple stacked/horizontal nav on small viewports).

**Rationale**: Keeps the baseline dependency-light. CSS Modules are scoped and co-located with components, matching the repo's "no shared styling system specified" state.

**Alternatives considered**: *Tailwind CSS* (fast to iterate, but adds a build dependency and config for no baseline requirement); *styled-components/emotion* (runtime CSS-in-JS, unnecessary weight). All deferred; the layout contract is what matters for the baseline.

---

## 9. Testing strategy

**Decision**: Jest + React Testing Library for component/unit specs (`.spec.tsx`/`.spec.ts`) co-located with the code; the monorepo `turbo run build` acts as the type gate. The client's `lint` script uses the same flat `eslint.config.mjs` (typescript-eslint type-checked) pattern as the other apps.

**Rationale**: CI today only runs core unit tests and `turbo run build`; the client must at least build cleanly. Component specs prove the shell/nav/login error states. No e2e harness is added in the baseline.

**Alternatives considered**: *Playwright/Cypress e2e* — valuable but out of scope for a baseline scaffold; noted as a later addition.

---

## 10. Open items (non-blocking, deferred)

- Token refresh (`POST /auth/refresh`) is available in the backend but the baseline only exercises login → authenticated reads; automatic refresh-on-401 is deferred.
- httpOnly-cookie/proxy auth hardening (see §6).
- Real-time updates (README mentions them) — not in baseline scope.
