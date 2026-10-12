---
description: "Task list for Client Application Baseline implementation"
---

# Tasks: Client Application Baseline

**Input**: Design documents from `/specs/001-client-app-baseline/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not requested in the feature specification — no TDD test tasks are generated. The `turbo run build` (de-facto type check) and `turbo run lint` are the quality gates. Optional Jest + React Testing Library harness is wired in Phase 1 so `npm run test -w client_app` is available for future work.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Every description includes exact file path(s)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold `apps/client_app` into a real Next.js workspace app.

- [X] T001 Create `apps/client_app/package.json` — workspace entry with `name: client_app`; scripts `dev` (next dev), `build` (next build), `lint` (eslint --fix), `type-check` (tsc --noEmit), `test` (jest); dependencies: `next@15`, `react@19`, `react-dom@19`, `@tanstack/react-query@5`, `@repo/contracts: "*"`; devDependencies: `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `eslint`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `jest`, `@testing-library/react`, `@testing-library/jest-dom`, `ts-jest`.
- [X] T002 [P] Create `apps/client_app/next.config.ts` — load the repo-root `.env` via `dotenv` (resolve `../../.env`) and expose only browser-safe values: `NEXT_PUBLIC_AUTH_SERVICE_URL` (from `AUTH_SERVICE_URL`) and `NEXT_PUBLIC_CORE_SERVICE_URL` (from `CORE_SERVICE_URL`). Never prefix backend secrets (`JWT_SECRET`, DB/Redis/SMTP/S3 vars) with `NEXT_PUBLIC_`.
- [X] T003 [P] Create `apps/client_app/eslint.config.mjs` — flat config with `typescript-eslint` (type-checked) + `eslint-config-prettier`, mirroring `apps/core_microservice/eslint.config.mjs`.
- [X] T004 [P] Create `apps/client_app/.prettierrc` — `{ "singleQuote": true, "trailingComma": "all" }` (matches other apps).
- [X] T005 [P] Create `apps/client_app/src/lib/config.ts` — export typed client config reading `process.env.NEXT_PUBLIC_AUTH_SERVICE_URL` and `process.env.NEXT_PUBLIC_CORE_SERVICE_URL`, plus `CLIENT_PORT` default `3000` (client's own port, distinct from backend `*_PORT` vars).
- [X] T006 [P] Create `apps/client_app/next-env.d.ts` (Next-generated declaration) and verify the existing `apps/client_app/tsconfig.json` stub (`"jsx": "preserve"`, `"moduleResolution": "bundler"`, next plugin) is correct; do not delete its `.next/types` include.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core client infrastructure every user story depends on. No user story work begins before this phase.

**⚠️ CRITICAL**: Blocks US1, US2, and US3.

- [X] T007 [P] Create `apps/client_app/src/app/globals.css` — global reset, mobile-first base styles, fluid/container layout helpers, and CSS variables for Innogram branding colors; usable across desktop/tablet/mobile (FR-011, SC-004).
- [X] T008 [P] Create `apps/client_app/src/components/brand/logo.tsx` — Innogram wordmark/logo component (shared by the home screen and the header).
- [X] T009 [P] Create `apps/client_app/src/lib/auth/auth-context.tsx` — React context `AuthProvider` holding `{ accessToken, refreshToken, user }` with `login()` / `logout()` and `localStorage` hydration (re-hydrate on load); default state `signedOut`. Export `useAuth()` hook.
- [X] T010 Create `apps/client_app/src/lib/api/client.ts` — typed `fetch` wrapper: injects base URL from `lib/config.ts`, attaches `Authorization: Bearer <accessToken>` from `useAuth()`, parses JSON, and throws a typed error on non-2xx (consumed by UI error states). Depends on T005, T009.
- [X] T011 Create `apps/client_app/src/app/layout.tsx` — root layout: `<html><body>`, import `globals.css`, wrap children in `AuthProvider` (from T009). No header/nav yet (added in US2). Depends on T007, T009.

**Checkpoint**: Foundation ready — user stories can begin.

---

## Phase 3: User Story 1 — Application boots and renders the Innogram home screen (Priority: P1) 🎯 MVP

**Goal**: Starting `npm run dev` and opening a browser shows a branded, responsive home screen with a visible content area.

**Independent Test**: `npm run dev`, open `http://localhost:3000` — the Innogram home screen renders with branding and a content area within 3 s (SC-002); resize to desktop/tablet/mobile and it stays usable (SC-004).

### Implementation for User Story 1

- [X] T012 [US1] Create `apps/client_app/src/app/page.tsx` — Home/Feed section rendering the Innogram logo (`components/brand/logo.tsx`) and a visible content-area placeholder (the placeholder is replaced by the feed list in US3). Depends on Phase 2.

**Checkpoint**: User Story 1 fully functional and independently testable.

---

## Phase 4: User Story 2 — Consistent navigation shell linking core sections (Priority: P2)

**Goal**: A persistent header + navigation element on every screen linking Home/Feed and Profile, plus a friendly not-found screen.

**Independent Test**: From the home screen, select `Profile` then `Home` from the nav — each section renders inside the shared layout without re-entering the app address (FR-003); visiting an unknown path shows a friendly 404 (FR-005). 100% of primary destinations reachable (SC-003).

### Implementation for User Story 2

- [X] T013 [P] [US2] Create `apps/client_app/src/components/nav/header.tsx` — persistent header using `components/brand/logo.tsx`, responsive (collapses gracefully on mobile).
- [X] T014 [P] [US2] Create `apps/client_app/src/components/nav/nav-links.tsx` — navigation links for the baseline sections: `Home` → `/`, `Profile` → `/profile` (per spec "Assumptions": Home/Feed and Profile are the two baseline sections).
- [X] T015 [US2] Integrate `header.tsx` + `nav-links.tsx` into `apps/client_app/src/app/layout.tsx` so the shell persists across all routes. Depends on T013, T014.
- [X] T016 [P] [US2] Create `apps/client_app/src/app/profile/page.tsx` — Profile section placeholder rendering inside the shared shell (placeholder replaced by profile card in US3).
- [X] T017 [P] [US2] Create `apps/client_app/src/app/not-found.tsx` — friendly "not found" screen (FR-005); no blank/broken page.

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 — Baseline connectivity to backend services (Priority: P3)

**Goal**: Login flow obtains a JWT; Home renders feed posts (`GET /posts/feed`) and Profile renders the signed-in user's own profile (`GET /profiles/me`); backend unavailability shows an error/retry state that auto-recovers.

**Independent Test**: With backend services running, sign in with valid credentials (SC-007) → Profile shows the user's own profile, Home shows feed posts (FR-006, FR-013). Stop the core service → Home/Profile show a friendly error/retry state without crashing; restart core → data re-fetches automatically and the error clears without a restart (FR-007, SC-005).

### 5.1 Shared contracts (`@repo/contracts` — posts + auth do not exist yet)

> The client imports only `@repo/contracts` (never `@repo/shared`). Add the two missing contract modules; backend DTOs `implements` them (existing `ProfileResponseDto implements IProfileResponse` precedent).

- [X] T018 [P] [US3] Create `packages/contracts/src/auth/requests.ts` — `ILoginRequest { email: string; password: string }` (mirrors `LoginDto`: email must be a valid email, password min length 8).
- [X] T019 [P] [US3] Create `packages/contracts/src/auth/responses.ts` — `IAuthUserResponse { id: string; email: string; isEmailVerified: boolean; roles?: string[]; createdAt: string; updatedAt: string }` and `ILoginResponse { accessToken: string; refreshToken: string; user: IAuthUserResponse }`.
- [X] T020 [P] [US3] Create `packages/contracts/src/auth/index.ts` — re-export `./requests` and `./responses`.
- [X] T021 [P] [US3] Create `packages/contracts/src/posts/responses.ts` — `enum PostStatus { Draft = 'draft', Published = 'published', Archived = 'archived' }`, `IPostAssetResponse { assetId: string; displayOrder: number }`, `IPostResponse { id; authorId; content; status: PostStatus; assets?: IPostAssetResponse[]; createdAt; updatedAt }`, and `IFeedResponse { items: IPostResponse[]; total: number; page: number; limit: number }` (NOTE: `items`, not `data` — matches `GET /posts/feed`).
- [X] T022 [P] [US3] Create `packages/contracts/src/posts/index.ts` — re-export `./responses`.
- [X] T023 [US3] Update `packages/contracts/src/index.ts` to also `export * from "./auth"` and `export * from "./posts"`, then rebuild `@repo/contracts` (`npm run build -w @repo/contracts`) so the client can import the new types. Depends on T018–T022.

### 5.2 Backend prerequisites (additive, read-path — see plan "Scope Adjustments")

- [X] T024 [US3] Add `getProfileByAuthUserId(authUserId: string)` to `apps/core_microservice/src/modules/profiles/profiles.service.ts` — wraps the existing `UserProfileRepository.findByAuthUserId(authUserId)` (already present in `infrastructure/repository/user-profile.repository.ts`). No schema change.
- [X] T025 [US3] Add `@Get('me')` + `@UseGuards(JwtAuthGuard)` + `@CurrentUser('sub')` route to `apps/core_microservice/src/modules/profiles/profiles.controller.ts`, returning `ProfileResponseDto` (already implements `IProfileResponse`). Depends on T024.
- [X] T026 [P] [US3] Add `@UseGuards(JwtAuthGuard)` to the existing `getFeed` handler in `apps/core_microservice/src/modules/posts/posts.controller.ts` (currently reads `@CurrentUser('sub')` without a guard, so the personalized feed receives `undefined`). No service/schema change.

### 5.3 Client auth + data fetching

- [X] T027 [US3] Create `apps/client_app/src/lib/auth/login.ts` — `login(email, password)` calling `POST /auth/login` via `lib/api/client.ts`, typed against `ILoginRequest`/`ILoginResponse`, persisting `accessToken`/`refreshToken`/`user`; wire into `AuthProvider.login()`. Depends on T023, T010.
- [X] T028 [P] [US3] Create `apps/client_app/src/lib/query/provider.tsx` — `QueryClient` configured with `retry` and `refetchInterval` (interval re-attempt while in error) for automatic recovery (FR-007/SC-005); mount the provider in the root layout. Depends on Phase 2.
- [X] T029 [US3] Create `apps/client_app/src/app/login/page.tsx` — login form: email/password fields with inline validation (email format; password min 8), submit calls `login()`, shows form errors on failure, redirects to `/` on success. Depends on T027, T028.
- [X] T030 [US3] Create `apps/client_app/src/lib/api/feed.ts` — fetch `GET /posts/feed` typed as `IFeedResponse` (query params `page` default 1, `limit` default 20). Depends on T023, T010.
- [X] T031 [US3] Create `apps/client_app/src/lib/api/profile.ts` — fetch `GET /profiles/me` typed as `IProfileResponse`. Depends on T023, T010.
- [X] T032 [P] [US3] Create `apps/client_app/src/components/common/async-state.tsx` — shared loading (skeleton/spinner) + friendly error + retry affordance component consumed by feed and profile (FR-007).
- [X] T033 [US3] Create `apps/client_app/src/components/feed/feed-list.tsx` — `useQuery` for the feed with loading/error/retry states (via `async-state.tsx`); renders posts from `items`. Depends on T028, T030, T032.
- [X] T034 [US3] Replace the Home content-area placeholder in `apps/client_app/src/app/page.tsx` with `components/feed/feed-list.tsx`. Depends on T033.
- [X] T035 [US3] Create `apps/client_app/src/components/profile/profile-card.tsx` — `useQuery` for `/profiles/me` with loading/error/retry states (via `async-state.tsx`); renders `displayName`, `username`, `bio`, `avatarUrl`. Depends on T028, T031, T032.
- [X] T036 [US3] Replace the Profile placeholder in `apps/client_app/src/app/profile/page.tsx` with `components/profile/profile-card.tsx`. Depends on T035.

**Checkpoint**: All user stories independently functional; login → authenticated feed + own profile works end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Boundary + quality-gate validation across all stories.

- [X] T037 [P] Boundary check — grep `apps/client_app` for `@repo/shared` (must be zero matches) and confirm only `@repo/contracts` is imported from `packages/` (constitution III, FR-009).
- [X] T038 [P] Run `npm run lint`, `npm run build`, and `npm run type-check` (client app) to pass the CI gates, then walk every scenario in `specs/001-client-app-baseline/quickstart.md` (scenarios 1–8) and confirm each passes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories.**
- **User Stories (Phase 3–5)**: All depend on Foundational completion. US1 and US2 have no data/backend dependencies; US3 depends on the `@repo/contracts` additions (T018–T023) and the backend prerequisites (T024–T026).
- **Polish (Phase 6)**: Depends on all desired stories.

### User Story Dependencies

- **US1 (P1)**: After Foundational. No dependencies on other stories.
- **US2 (P2)**: After Foundational. Reuses the logo (T008) from Foundational; independent of US1 and US3.
- **US3 (P3)**: After Foundational. Depends on the new `@repo/contracts` modules and the two additive backend changes; independent of US1/US2 UI but replaces their placeholders (T034, T036).

### Within Each User Story

- Contracts before client code that imports them (T018–T023 before T027/T030/T031).
- Backend service method before controller route (T024 before T025).
- API/data-layer before UI components before page wiring (e.g. T030/T032 → T033 → T034).
- Build `@repo/contracts` before the client compiles against it (T023).

### Parallel Opportunities

- Phase 1: T002–T006 all touch different files and can run in parallel.
- Phase 2: T007, T008, T009 are independent files ([P]).
- Phase 5 contracts: T018–T022 are independent files; T024/T026 backend changes are independent of them.
- Phase 5 client: T028, T030, T031, T032 are independent files ([P]).
- Different user stories can be worked in parallel by different developers after Foundational.

---

## Parallel Example: User Story 3 (contracts)

```bash
# Launch the independent contract files together:
Task: "Create packages/contracts/src/auth/requests.ts (ILoginRequest)"
Task: "Create packages/contracts/src/auth/responses.ts (IAuthUserResponse, ILoginResponse)"
Task: "Create packages/contracts/src/auth/index.ts"
Task: "Create packages/contracts/src/posts/responses.ts (PostStatus, IPostResponse, IFeedResponse)"
Task: "Create packages/contracts/src/posts/index.ts"
```

```bash
# Independent backend change (can run alongside contracts):
Task: "Add @UseGuards(JwtAuthGuard) to getFeed in posts.controller.ts"
Task: "Add getProfileByAuthUserId to profiles.service.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational — CRITICAL, blocks all stories).
3. Complete Phase 3 (US1).
4. **STOP and VALIDATE**: `npm run dev` → home screen renders branded + responsive.
5. Demo if ready.

### Incremental Delivery

1. Setup + Foundational → app boots.
2. US1 → branded home screen (MVP!).
3. US2 → shared navigation shell + 404.
4. US3 → login + authenticated feed + own profile + auto-recovery.
5. Each story adds value without breaking previous stories.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. Once Foundational done:
   - Developer A: US1 (+ US2 shell if same dev).
   - Developer B: contracts (T018–T023) + backend prerequisites (T024–T026).
3. When contracts + backend land, the client data layer + login (US3) proceeds.

---

## Notes

- `[P]` tasks = different files, no dependencies.
- `[Story]` label maps a task to its user story for traceability.
- Each user story is independently completable and testable.
- Backend changes (T024–T026) are additive read-path changes only — no schema/migration (see plan "Scope Adjustments").
- Do not import `@repo/shared` anywhere in `apps/client_app` (constitution III).
- Commit after each task or logical group (per repo Git workflow).
- Stop at any checkpoint to validate a story independently.
