# Implementation Plan: Post Feed

**Branch**: `002-post-feed` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-post-feed/spec.md`

## Summary

Deliver the full post-feed product surface across the existing `core_microservice` (NestJS + Hexagonal DDD) and `apps/client_app` (Next.js App Router), building on the `001-client-app-baseline` shell (login/JWT, navigation, Home feed, own profile). The spec splits cleanly into capabilities the backend **already exposes** (post create/publish/archive/delete, follow-based feed, search, comment CRUD, asset upload) and capabilities that **do not exist yet** and must be added: post **like/unlike**, **re-post** with attribution, a global **Discover** feed, **engagement counts** (like/comment/repost counts + "liked by me"), feed **sort** (newest/oldest/most-liked) and **media-type filter** (photos/videos/text), plus the full client surface (compose with media upload, edit/delete, media gallery/lightbox, comment UI, sort/filter controls, search UI, share actions).

The backend work is additive and concentrated in the `posts` aggregate (new `PostLike`/`Repost` persistence + endpoints, engagement counting, an extended feed query), a small hardening of the `assets` upload path (MIME whitelist), and security fixes to existing mutating post endpoints that are currently missing `JwtAuthGuard`. The client work adds new pages/components (compose, post detail + comments, media gallery, search) and enriches the existing feed list. Wire shapes change in `@repo/contracts` only (never `@repo/shared`), following constitution III.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (matches monorepo toolchain).

**Primary Dependencies**: NestJS 10 (`core_microservice`), TypeORM + Postgres, `@repo/shared` (TypeORM base classes, DTOs, domain errors, logger, filters) and `@repo/contracts` (wire types) on the backend; Next.js 15 (App Router) + React 19 + TanStack Query v5 + `@repo/contracts` on the client; MinIO (S3-compatible) via `@aws-sdk/client-s3` for media. Dev-only: Jest, flat `eslint.config.mjs` (typescript-eslint type-checked), Prettier.

**Storage**: PostgreSQL (per-service DB `innogram_core`) via TypeORM migrations (`synchronize: false`); media files in MinIO/S3 (`assets` table + bucket `innogram-assets`). New persistence for this feature: a `reposts` table (new migration). `post_likes` and `comment_likes` tables already exist (migrations `AddExplicitLikes`) but have **no** service/controller/repository yet.

**Testing**: Jest unit specs (`*.spec.ts`, `rootDir: src`) alongside domain code; `turbo run build` is the de-facto type gate. New domain logic (post status transitions, like idempotency, repost) gets entity specs; service/controller get spec coverage mirroring existing `*.service.spec.ts`/`*.controller.spec.ts`. No new e2e harness.

**Target Platform**: Web browsers (desktop, tablet, mobile viewports — SC-009).

**Project Type**: Web application (frontend + backend microservice).

**Performance Goals**: Feed renders within 3 s on standard broadband (SC-001); sort/filter updates in under 2 s (SC-007); create-and-publish flow under 2 minutes (SC-003). Engagement counts are aggregated in the same feed query (no N+1 per post).

**Constraints**:
- Client imports `@repo/contracts` only — never `@repo/shared` (constitution III, FR/assumption).
- Schema changes via TypeORM migrations, run per-app (`npm run migration:run -w core_microservice`); `synchronize: false`.
- Mutating endpoints MUST be JWT-guarded and verify ownership (constitution V). This feature fixes existing unguarded post mutations.
- Post text ≤ 500 chars; ≤ 10 media items/post; ≤ 10 MB/file (spec assumptions).
- No cross-service DB access (constitution I).

**Scale/Scope**: 7 user stories, 27 functional requirements. Backend: extend `posts` module (+ `reposts` table, like endpoints, feed query), harden `assets` upload. Client: ~6 new routes/components (compose, post detail + comments, gallery, search) plus feed enrichment and sort/filter controls. Comment-like and notifications are explicitly **out of scope**.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|-----------|---------|-------|
| I. Microservice Autonomy & Domain Ownership | PASS | New `reposts` table lives in `innogram_core` (own migration); no cross-service DB reads/writes. Media stays in MinIO via the existing `IFileStoragePort`. |
| II. Hexagonal Architecture (Ports & Adapters) | PASS | Like/repost logic added as domain entities (already-existing `PostLike` + new `Repost`) with repository ports/adapters; business rules (status transitions, like idempotency, repost of published-only) live in entity methods, not controllers/services. |
| III. Package Boundary (`@repo/contracts` vs `@repo/shared`) | PASS | **Critical gate.** All new wire shapes (`IPostResponse` engagement fields, `IRepostResponse`, `IFeedItem`, sort/filter params) go in `@repo/contracts`; backend DTOs `implements` them; client imports `@repo/contracts` only. `class-validator` DTOs stay in module `dto/` or `@repo/shared/dtos/core`. |
| IV. Domain Errors over Framework Exceptions | PASS (with cleanup) | New code throws `DomainError` subclasses (e.g. `InvalidPostStateError`, `UnauthorizedError`) mapped by `DomainExceptionFilter`. **Pre-existing deviation**: `posts.service.ts` and `comments.service.ts` currently throw NestJS `ForbiddenException` for ownership checks — this feature migrates those to `@repo/shared` `UnauthorizedError` while touching those paths. |
| V. Security & Ownership Enforcement (Non-Negotiable) | PASS (requires fixes) | New like/repost endpoints use `JwtAuthGuard` + `@CurrentUser('sub')` and verify ownership. **Required fix**: `PATCH /posts/:id`, `POST /posts/:id/publish`, `POST /posts/:id/archive`, `DELETE /posts/:id` currently lack `@UseGuards(JwtAuthGuard)` — add it so IDOR checks actually run. |

**Verdict**: PASS — no new violations. Two pre-existing gaps (unguarded post mutations; `ForbiddenException` in services) are corrected as part of this feature and tracked below. Re-checked post-design (see [research.md](./research.md)): unchanged.

## Scope Adjustments (vs. spec Assumptions)

The spec assumes "the backend already exposes post creation, the follow-based feed, search, update, publish/archive, and deletion, as well as comment and asset-upload capabilities." This is **confirmed** with one correction: the *following feed, search, and comment CRUD are present but are not yet reachable from the client*, and several mutating post endpoints are **not actually authenticated**. The "backend capabilities that do not currently exist" (spec: like, re-post, Discover feed, engagement counts) are confirmed and enumerated precisely in [research.md](./research.md) §1. In addition to those, this feature requires:

1. **Authentication on mutating post endpoints** — `PATCH /posts/:id`, `publish`, `archive`, `delete` read `@CurrentUser('sub')` but lack `JwtAuthGuard` (constitution V). Additive, no schema change.
2. **Upload type validation** — `POST /assets/upload` validates size only (10 MB); FR-006/edge-cases require rejecting unsupported types. Add a MIME whitelist.
3. **Author summary in post responses** — `PostResponseDto` exposes only `authorId` (a UUID); FR-001 requires showing the author. Add an `author` summary (profile already joined via the repository's `author` relation).
4. **Media edit** — `UpdatePostDto` supports text only; FR-008 requires editing media too. Add `assetIds` to update.
5. **Empty drafts** — `CreatePostDto` requires non-empty `content`, blocking empty drafts (FR-024). Relax content to optional at create; `publish()` already rejects empty content (FR-007).

Details and alternatives for every item in [research.md](./research.md).

## Project Structure

### Documentation (this feature)

```text
specs/002-post-feed/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── README.md        # Index + contract conventions
│   ├── post.md          # Post resource (lifecycle, media, author, engagement)
│   ├── feed.md          # Feed + Discover (sort/filter/pagination)
│   ├── likes.md         # Like/unlike a post
│   ├── reposts.md       # Re-post / un-re-post
│   ├── comments.md      # Comment CRUD
│   ├── assets.md        # Media upload
│   └── search.md        # Post search
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created here)
```

### Source Code (repository root)

```text
# Backend — core_microservice (NestJS + Hexagonal DDD)
apps/core_microservice/src/
├── modules/
│   ├── posts/                                   # EXTEND (aggregate for feed/like/repost)
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   │   ├── post.entity.ts               # EXTEND (repost count? keep status logic; add repostedBy if needed)
│   │   │   │   ├── post-like.entity.ts          # EXISTS (persistence only today)
│   │   │   │   └── repost.entity.ts             # NEW
│   │   │   ├── interfaces/
│   │   │   │   ├── post.props.ts                # EXTEND
│   │   │   │   └── repost-repository.port.ts    # NEW
│   │   │   └── errors/post.errors.ts            # NEW (repost/like domain errors)
│   │   ├── dto/
│   │   │   ├── create-post.dto.ts               # EXTEND (optional content, publish flag)
│   │   │   ├── update-post.dto.ts               # EXTEND (assetIds)
│   │   │   ├── feed-query.dto.ts                # EXTEND (feed, sort, mediaType)
│   │   │   ├── post-response.dto.ts             # EXTEND (author, counts, likedByMe)
│   │   │   └── repost-response.dto.ts           # NEW
│   │   ├── infrastructure/repository/
│   │   │   ├── post.repository.ts               # EXTEND (discover, sort/filter, counts)
│   │   │   ├── post-like.repository.ts          # NEW
│   │   │   └── repost.repository.ts             # NEW
│   │   ├── posts.controller.ts                  # EXTEND (like/repost routes, guards)
│   │   ├── posts.service.ts                     # EXTEND (like/unlike, repost, discover)
│   │   └── posts.module.ts                      # EXTEND (register new repos/entities)
│   ├── assets/
│   │   ├── assets.controller.ts                 # EXTEND (MIME whitelist validator)
│   │   └── assets.service.ts                    # EXTEND (type validation)
│   └── migrations/
│       └── 1786xxxxxxxxxx-AddReposts.ts         # NEW (reposts table)
packages/contracts/src/
├── posts/
│   ├── requests.ts                              # NEW (create/update post, feed query)
│   ├── responses.ts                             # EXTEND (engagement, author, repost)
│   └── index.ts
└── index.ts                                     # EXTEND (exports)
packages/shared/src/dtos/core/                   # EXTEND if a DTO is shared across services (else module-local)
└── (create/update comment already here)

# Frontend — client_app (Next.js App Router)
apps/client_app/src/
├── app/
│   ├── page.tsx                                 # EXTEND (feed tabs + sort/filter)
│   ├── compose/page.tsx                         # NEW (create/post UI + upload)
│   ├── posts/[id]/page.tsx                      # NEW (post detail + comments + gallery)
│   ├── search/page.tsx                          # NEW (search interface)
│   └── ...existing (login, signup, profile, not-found)
├── components/
│   ├── feed/                                    # EXTEND (PostCard: media, engagement, actions)
│   ├── posts/                                   # NEW (PostForm, PostActions, MediaGallery, Comments)
│   └── common/                                  # EXTEND (share/lightbox primitives)
└── lib/
    └── api/                                     # EXTEND (posts, likes, reposts, comments, assets, search)
```

**Structure Decision**: The `posts` aggregate in `core_microservice` is extended in place (it already owns `Post`, `PostLike`, `PostAsset` and the follow-based feed) rather than spinning up a new module — liking and re-posting are post interactions, and a separate module would duplicate the repository/feed plumbing for no benefit. The new `Repost` entity lives beside `Post` under `modules/posts/domain/entities/` with its own port/adapter, mirroring the canonical `profiles` layout. On the client, new capabilities follow the established App Router + `components/*` + `lib/api/*` pattern from `001-client-app-baseline`. All wire types land in `@repo/contracts` (constitution III).

## Complexity Tracking

> No constitution violations. The table records the two pre-existing gaps corrected in-scope and why the fix is non-optional.

| Item | Why Needed | Notes |
|------|------------|-------|
| Add `JwtAuthGuard` to mutating post endpoints | Constitution V (ownership MUST be enforced) — these routes read `@CurrentUser('sub')` but are unauthenticated today, so `userId` is `undefined` and IDOR checks silently pass. | Additive; no schema change. |
| Migrate `ForbiddenException` → `UnauthorizedError` in posts/comments services | Constitution IV (domain code must not throw framework exceptions). | Touches the ownership checks this feature already rewrites. |
