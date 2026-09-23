# Data Model: Client Application Baseline

**Feature**: `001-client-app-baseline` | **Date**: 2026-09-23

The client owns no database. This document describes the **client-side conceptual entities** (from the spec's "Key Entities"), the **wire types** they render (defined in `@repo/contracts`, documented in [contracts/](./contracts/README.md)), and the **session state** the client manages. Backend persistence is owned by the existing services and is out of scope here.

---

## 1. Client entities

### 1.1 Application Shell

The shared layout present on every screen.

| Field | Type | Notes |
|-------|------|-------|
| header | node | Branded header with the Innogram mark |
| nav | NavigationSection[] | Persistent navigation element (FR-003) |
| content | node | Current section rendered in the shared layout (FR-004) |

- Present in the root `layout.tsx`; every route renders inside it.
- Never unmounts between sections (FR-003 acceptance: "move between sections without re-entering the application address").

### 1.2 Navigation Section

A primary destination reachable from the navigation element.

| Field | Type | Notes |
|-------|------|-------|
| key | string | Route key (`home`, `profile`) |
| label | string | Display text (`Home`, `Profile`) |
| href | string | Route path (`/`, `/profile`) |

Baseline sections (per spec "Assumptions"): **Home/Feed** (`/`) and **Profile** (`/profile`). Additional sections are later features.

### 1.3 Authenticated User (Session)

The signed-in identity established via the auth service, carried as a JWT.

| Field | Type | Notes |
|-------|------|-------|
| accessToken | string | JWT from `POST /auth/login`; attached as `Authorization: Bearer` |
| refreshToken | string | Refresh token from login; stored but not exercised in the baseline |
| user | IAuthUserResponse | `{ id, email, isEmailVerified, roles? }` — `id` is the JWT `sub` |

- Persisted in `localStorage` (see [research.md](./research.md) §6 for the XSS tradeoff).
- The JWT payload is `{ sub: user.id, email }` — `sub` is the auth user id used to resolve the caller's own profile.

---

## 2. Wire types rendered by the client

These are consumed from `@repo/contracts` (never re-declared in the client). Full shapes and validation rules in [contracts/](./contracts/README.md).

| Client view | Contract type | Source endpoint |
|-------------|---------------|-----------------|
| Home/Feed list | `IFeedResponse` → `IPostResponse[]` | `GET /posts/feed` |
| Profile display | `IProfileResponse` | `GET /profiles/me` |
| Login result | `ILoginResponse` → `IAuthUserResponse` | `POST /auth/login` |

### 2.1 Feed (Home)

- Paginated envelope `IFeedResponse { items, total, page, limit }` (note `items`, not `data`).
- Each `IPostResponse` carries `id, authorId, content, status, assets?, createdAt, updatedAt`.
- The client renders published posts returned by the (personalized) feed; status filtering is a backend concern.

### 2.2 Profile

- `IProfileResponse { id, authUserId, username, displayName, bio, avatarUrl, createdAt, updatedAt }` — already defined in `@repo/contracts`.
- The client renders `displayName`, `username`, `bio`, `avatarUrl`.

---

## 3. Client state (UI state machine)

State transitions the client must model per data fetch (drives FR-007 / SC-005):

```
idle ──fetch──▶ loading ──success──▶ success
                  │
                  └──error──▶ error ──(refetchInterval / retry)──▶ loading ──▶ success
```

| State | Meaning | UI |
|-------|---------|----|
| `loading` | Initial/in-flight request | Skeleton/spinner |
| `success` | Data received | Rendered content |
| `error` | Backend unreachable/erroring | Friendly message + retry affordance; automatic interval re-attempt (FR-007) |

On any successful response the error state clears automatically (no restart). This is implemented with TanStack Query (`status`, `retry`, `refetchInterval`).

### Auth state

```
signedOut ──login success──▶ signedIn ──logout──▶ signedOut
```

- `signedIn` gates the authenticated views (Profile, and the Authorization header on feed/profile requests).
- Login failure stays `signedOut` and surfaces a form error.

---

## 4. Validation rules (client-side, mirror of contracts)

- Login email/password are validated against `ILoginRequest` (`email` format, `password` min 8 — matches `LoginDto`); the client shows inline errors and does not submit invalid input.
- No client-side mutation of profile/posts in the baseline (read-only).

---

## 5. Relationships

```
AuthProvider (session)
   │  provides accessToken + user.id (JWT sub)
   ├──▶ FeedQuery  ──GET /posts/feed──▶ IFeedResponse
   └──▶ ProfileQuery ──GET /profiles/me──▶ IProfileResponse

ApplicationShell
   └──▶ NavigationSection[] (Home/Feed, Profile)
```

- The client does not join entities; the backend returns fully-shaped resources per contract.
- No client-side foreign keys beyond `user.id` → `authUserId` (the value used by `/profiles/me`).
