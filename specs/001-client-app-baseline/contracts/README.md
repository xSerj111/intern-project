# Contracts — Client Application Baseline

This directory documents the **interface contracts** the client consumes. These are wire-format request/response shapes, defined once in `packages/contracts` (`@repo/contracts`) and shared with the backend rather than duplicated in the client (constitution III).

- The client imports these types from `@repo/contracts` only — never from `@repo/shared`.
- Two contract modules **do not exist yet** and are added as part of this feature: `posts` and `auth` (see [research.md](../research.md) §4). The backend DTOs will `implements` them, following the existing `ProfileResponseDto implements IProfileResponse` precedent.
- Dates are serialized as ISO 8601 strings over the wire.

| Contract file | Endpoint(s) | Status |
|---------------|-------------|--------|
| [auth.md](./auth.md) | `POST /auth/login` | **new** — add `auth` module to `@repo/contracts` |
| [feed.md](./feed.md) | `GET /posts/feed` | **new** — add `posts` module to `@repo/contracts` |
| [profile.md](./profile.md) | `GET /profiles/me` | `IProfileResponse` exists; `/profiles/me` route is **new** |

> The backend response shapes are authoritative (the client does not re-declare them). Where the current backend DTO already defines a shape (e.g. `PostResponseDto`), the contract mirrors it exactly.
