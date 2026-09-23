# Implementation Plan: Client Application Baseline

**Branch**: `001-client-app-baseline` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-client-app-baseline/spec.md`

## Summary

Stand up the `apps/client_app` frontend as a real Next.js (App Router) web application — today it is a stub (`tsconfig.json` only, no `package.json`). The baseline delivers the application shell (persistent header + navigation), a Home/Feed section that renders feed posts, a Profile section that renders the signed-in user's own profile, a login flow that obtains a JWT from the auth service, and graceful error/retry handling when a backend service is unavailable. The client consumes only `@repo/contracts` (never `@repo/shared`) and reads its own configuration from the shared root `.env`.

Two small, additive backend changes are required to make the stated requirements actually work end-to-end (documented in [research.md](./research.md) and listed under "Scope Adjustments" below):

1. Add a read-only, JWT-guarded `GET /profiles/me` endpoint to `core_microservice` (the repository already exposes `findByAuthUserId()`; the controller does not).
2. Add `@UseGuards(JwtAuthGuard)` to the existing `GET /posts/feed` handler so the personalized feed receives the authenticated user id (today the handler reads `@CurrentUser('sub')` without a guard, so `userId` is `undefined`).

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (matches monorepo toolchain).

**Primary Dependencies**: Next.js 15 (App Router) + React 19; `@repo/contracts` (wire-format types); TanStack Query v5 (retry / interval refetch / error state); native `fetch` wrapped in a typed client. Dev-only: Jest + React Testing Library, flat `eslint.config.mjs` (typescript-eslint type-checked), Prettier.

**Storage**: N/A — the client owns no database. The signed-in session (access token, refresh token, user) is held client-side in `localStorage`; the backend services own all persistence.

**Testing**: Jest + React Testing Library for unit/component specs (alongside the code, matching repo convention); the monorepo `turbo run build` is the de-facto type gate. No client e2e harness in this baseline.

**Target Platform**: Web browsers (desktop, tablet, mobile viewports — FR-011/SC-004).

**Project Type**: Web application (frontend).

**Performance Goals**: Home screen renders within 3 s on a standard broadband connection (SC-002).

**Constraints**:
- Must import `@repo/contracts` only; must **never** import `@repo/shared` (constitution III, FR-009).
- Must read its own distinct config values from the shared root `.env` (FR-008), exposing only browser-safe (`NEXT_PUBLIC_*`) values; never expose `JWT_SECRET` or other backend secrets.
- Must build and run through the standard Turborepo workflow (`npm run dev` / `npm run build`) (FR-001, FR-010, SC-006).

**Scale/Scope**: 2 primary navigation sections (Home/Feed, Profile), 1 login flow, 2 data fetches (feed posts, own profile), 1 not-found screen. Full feature logic (posting, following, commenting, other users' profiles) is explicitly out of scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|-----------|---------|-------|
| I. Microservice Autonomy & Domain Ownership | PASS | Client uses its own `CLIENT_PORT`, reaches the backend only over HTTP contracts; no cross-service DB access. |
| II. Hexagonal Architecture (Ports & Adapters) | N/A | Governs backend services. The client still separates the HTTP/data layer (`lib/api`) from UI components so contracts are the only coupling surface. |
| III. Package Boundary (`@repo/contracts` vs `@repo/shared`) | PASS | **Critical gate.** Client depends on `@repo/contracts` only. No `@repo/shared` import anywhere in `apps/client_app`. |
| IV. Domain Errors over Framework Exceptions | N/A | Backend concern. The client maps HTTP status codes to friendly error/retry UI states; it never throws backend domain errors. |
| V. Security & Ownership Enforcement | PASS | Client attaches the JWT (`Authorization: Bearer`) to backend requests (FR-013); exposes no secrets (FR-009); mutations are out of scope but the pattern is established. |

**Verdict**: PASS — no constitution violations. Re-checked post-design (see [research.md](./research.md) §6): unchanged.

## Scope Adjustments (vs. spec Assumptions)

The spec assumption "this feature only consumes [the backend], it does not modify them" is **narrowed** by two minimal additive changes required for FR-006/FR-013 to function (confirmed during planning):

1. `core_microservice`: add read-only `GET /profiles/me` (JWT-guarded, resolves via existing `findByAuthUserId`). No schema change, no new migration.
2. `core_microservice`: add `@UseGuards(JwtAuthGuard)` to `GET /posts/feed` so the personalized feed has the authenticated user id. No schema change.

Both are additive, read-path changes with no database/schema impact. Details and alternatives in [research.md](./research.md) §2 and §3.

## Project Structure

### Documentation (this feature)

```text
specs/001-client-app-baseline/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── README.md        # Index + contract conventions
│   ├── auth.md          # Login request/response, auth user, JWT payload
│   ├── feed.md          # Feed + post wire shapes
│   └── profile.md       # Profile wire shape (existing IProfileResponse)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created here)
```

### Source Code (repository root)

```text
apps/client_app/
├── package.json                 # NEW — workspace entry; dev/build/test/lint/type-check scripts
├── next.config.ts               # NEW — loads root .env via dotenv, maps NEXT_PUBLIC_* values
├── eslint.config.mjs            # NEW — flat config (matches other apps)
├── .prettierrc                  # NEW — singleQuote:true, trailingComma:"all"
├── tsconfig.json                # EXISTS — stub already targets Next.js; keep/verify
├── next-env.d.ts                # NEW — generated by Next
└── src/
    ├── app/
    │   ├── layout.tsx           # Application Shell: header + nav + content area (FR-002..FR-004)
    │   ├── page.tsx             # Home/Feed section — renders feed posts (FR-006)
    │   ├── login/page.tsx       # Login flow — POST /auth/login, store JWT (FR-012)
    │   ├── profile/page.tsx     # Profile section — renders own profile via /profiles/me (FR-013)
    │   └── not-found.tsx        # Friendly 404 screen (FR-005)
    ├── components/
    │   ├── nav/                 # Header + navigation links (Home/Feed, Profile)
    │   ├── feed/                # Feed list, post card, loading/error/retry states
    │   └── profile/             # Profile display, loading/error/retry states
    └── lib/
        ├── api/                 # Typed HTTP client + endpoints (types from @repo/contracts)
        ├── auth/                # AuthProvider (React context), token storage, login/logout
        └── config.ts            # Client config from NEXT_PUBLIC_* (no secrets)
```

**Structure Decision**: Next.js App Router under `apps/client_app` (the existing stub's `tsconfig.json` already targets `next`). The client is a workspace app so `turbo run` discovers it via the `apps/*` glob. It depends on `@repo/contracts` (build-order via `^build` in `turbo.json`) and on nothing else from `packages/`.

## Complexity Tracking

> No constitution violations — table intentionally empty.
