# Research: Post Feed

**Feature**: `002-post-feed` | **Date**: 2026-09-28

Phase 0 output. Resolves every open item from the Technical Context as a Decision / Rationale / Alternatives record. This is the evidence base for [data-model.md](./data-model.md) and [contracts/](./contracts/README.md).

---

## 1. Backend capability inventory (what exists vs. what is missing)

**Finding** (verified against source): the spec's split is mostly accurate, with corrections.

Already implemented in `core_microservice`:
- `posts` module — `Post` entity (draft/published/archived), `PostAsset` join, `PostLike` entity (table exists, **no endpoints**), `createPost`/`getPost`/`updatePost`/`publishPost`/`archivePost`/`softDeletePost`, follow-based `getFeed`, `searchPosts`.
- `comments` module — full CRUD (`create`, `update`, `getCommentsByPost`, `softDelete`), `CommentLike` entity (table exists, **no endpoints**).
- `follows` module — follow/unfollow + followers/following lists.
- `assets` module — `POST /assets/upload` (S3/MinIO) with 10 MB size limit.

Missing (delivered by this feature):
1. **Like/unlike** — `post_likes` table exists but has no service/controller/repository. (Comment likes remain out of scope: no FR requires liking comments.)
2. **Re-post** — no entity, table, or endpoint.
3. **Discover feed** — no global (all-public) feed.
4. **Engagement counts / liked-by-me** — `PostResponseDto` has none.
5. **Sort + media-type filter** — `FeedQueryDto` has `page`/`limit` only.
6. **Author summary** — `PostResponseDto` exposes `authorId` (UUID) only.

Gaps requiring correction (not in the spec's "does not exist" list):
7. **Unguarded mutating post endpoints** — `PATCH /posts/:id`, `publish`, `archive`, `delete` lack `JwtAuthGuard`.
8. **Upload type validation** — only size is checked, no image/video MIME whitelist.
9. **Media edit** — `UpdatePostDto` has no `assetIds`.
10. **Empty drafts** — `CreatePostDto.content` is `@IsNotEmpty`, blocking empty drafts.

**Decision**: Scope the backend work to exactly these items; every "does not exist" capability from the spec maps 1:1 to items 1–6, and items 7–10 are the minimal corrections required for FR-006/008/024 and constitution V.

**Alternatives considered**: introduce a message-broker for engagement (rejected — like/repost are request/response operations on the `posts` aggregate, not cross-service events); add comment-likes (rejected — out of scope).

---

## 2. Like / unlike backend design

**Decision**: Add like/unlike as **post interactions on the `posts` aggregate** — `POST /posts/:id/like` and `DELETE /posts/:id/like` (JWT-guarded), backed by a new `PostLikeRepository` over the existing `post_likes` table. The `PostLike` entity gains a `static create(postId, userId)` factory. The unique `(postId, userId)` index makes the operation idempotent: like of an already-liked post is a no-op; unlike of a not-liked post is a no-op.

**Rationale**:
- The entity and table already exist (`post_likes`, `@Index(['postId','userId'], { unique: true })`, soft-delete via `@DeleteDateColumn`); only the port/adapter/service/controller layer is missing.
- Liking is a sub-operation of the `Post` aggregate — no separate bounded context; a dedicated module would duplicate the repository base plumbing for two endpoints.
- Idempotency from the unique index means concurrent double-likes resolve to one row (satisfies the "simultaneous interactions stay consistent" edge case).

**Alternatives considered**: a separate `likes` module (more structure than two endpoints justify); a toggle endpoint `POST /posts/:id/like` that flips state (rejected — explicit like/unlike verbs are clearer and idempotent); storing a `likes` count column on `posts` (rejected — a denormalized count must be maintained transactionally and drift under concurrency; counting from `post_likes` is simpler and always correct).

---

## 3. Re-post entity & feed semantics

**Decision**: Introduce a `Repost` entity (`reposts` table: `id`, `originalPostId` FK→posts, `authorId` (the reposter), `createdAt`) with a `static create(originalPostId, authorId)` factory and a uniqueness guard to prevent duplicate re-posts of the same post by the same user. `POST /posts/:id/repost` and `DELETE /posts/:id/repost` (JWT-guarded). The feed includes a repost as a feed item that renders the **original** post's content/media/author with a "reposted by {author}" attribution.

**Rationale**:
- Attribution to the original author falls out naturally: the feed item embeds the original `Post` (with its own `author`) plus the reposter's summary — no data duplication.
- Soft-delete of the original post leaves the row intact (`deletedAt` set), so a repost whose original is deleted resolves to a "post unavailable" placeholder (FR-027) rather than breaking the feed — the feed query detects the original's `deletedAt` and emits `post: null`.

**Alternatives considered**: a self-referential `Post` with a `repostedFromId` column (rejected — muddles the `Post` lifecycle states and ownership; a repost has no draft/publish state of its own); copying content into a new post (rejected — breaks live attribution and delete-propagation).

---

## 4. Discover feed & unified feed query (sort/filter)

**Decision**: Extend the single list endpoint `GET /posts/feed` with query params instead of adding a parallel route:
- `feed`: `following` (default) | `discover` — `following` = followed accounts + own; `discover` = all public posts.
- `sort`: `newest` (default) | `oldest` | `most_liked`.
- `mediaType`: `photos` | `videos` | `text` (optional; absent = no filter).

**Rationale**: Following and Discover are two views of the same list (same pagination, sort, filter, and engagement shaping). One query path avoids duplicating the count/aggregation/relation logic; the `feed` discriminator is the only branch. FR-023 ("two feed views … switch between them") is satisfied by the client toggling `feed`.

**Alternatives considered**: a separate `GET /posts/discover` route (cleaner URL, but duplicates the entire sort/filter/pagination/shaping path); always-public Discover without auth (the route stays guarded so `likedByMe` is accurate, but Discover does not filter by the viewer's follows).

---

## 5. Engagement counts & liked-by-me

**Decision**: Extend `PostResponseDto` (and the `@repo/contracts` `IPostResponse`) with `likeCount`, `commentCount`, `repostCount`, and `likedByMe`. Counts are computed per post in the same read via aggregate queries (`COUNT` over `post_likes`/`comments`/`reposts` where not soft-deleted). `likedByMe` is true when the authenticated viewer has a non-deleted `post_likes` row for the post; for unauthenticated reads (`GET /posts/:id`, search) it is `false`.

**Rationale**: FR-001 requires "engagement summary (like state and comment count)"; FR-011 requires the like state to be consistent for the user. Computing counts from the source-of-truth tables (not a denormalized counter) keeps them correct under concurrent likes/comments (edge case) and requires no transactional counter maintenance.

**Alternatives considered**: denormalized `likeCount`/`commentCount` columns (rejected — drift risk); computing counts on the client from separate endpoints (rejected — N+1 requests and inconsistent UX); a bulk `countByPostIds` helper to avoid per-post queries (selected implementation detail — counts are batched in one query per read, documented in [data-model.md](./data-model.md)).

---

## 6. Media-type classification & filtering

**Decision**: Classify media type by deriving it from the asset `mimeType` (`image/*` → `photos`, `video/*` → `videos`) rather than adding a stored `type` column. A post is `text` when it has zero assets. The `mediaType` filter translates to: `photos` → posts having ≥1 image asset; `videos` → ≥1 video asset; `text` → no assets. The post response exposes `mediaType` on each asset and a derived post-level `mediaType`.

**Rationale**: The `assets` table deliberately dropped its old `type` column (migration `AddAssetsTable`) and retains `mimeType`, which is authoritative and already validated on upload. Deriving avoids a schema change and a second source of truth that could disagree with `mimeType`.

**Alternatives considered**: reintroduce a `type` enum column (rejected — redundant with `mimeType`; adds a migration and consistency risk); classify on the client from `mimeType` (works for display but cannot drive a server-side filter efficiently — rejected).

---

## 7. Upload type validation

**Decision**: Harden `POST /assets/upload` with a MIME whitelist (`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `video/mp4`, `video/webm`, `video/quicktime`) in addition to the existing 10 MB `MaxFileSizeValidator`, returning HTTP 400 for unsupported types (via a `DomainError`/validation error, mapped by the filter).

**Rationale**: FR-006/edge-cases require rejecting unsupported files with a friendly error before a post is created. NestJS `ParseFilePipe` supports composing validators; a custom `FileTypeValidator` fits the existing `MaxFileSizeValidator` pattern with no new dependency.

**Alternatives considered**: validate only on the client (rejected — client checks are advisory; the API must enforce FR-006); validate by file extension only (rejected — MIME from the multipart part is the authoritative signal).

---

## 8. Empty drafts & publish flow

**Decision**: Relax `CreatePostDto.content` to optional (`@IsOptional`, still `@MaxLength(500)`), and add an optional `publish?: boolean` (default `false`) to the create DTO. `POST /posts` always creates a `Post` via the factory (which defaults to `Draft`); when `publish: true`, the service calls `post.publish()` before save, which throws `InvalidPostStateError` if content is empty (FR-007). "Save draft" = create with `publish: false`.

**Rationale**: FR-024/025 require saving an empty (or in-progress) draft without publishing. The entity already encodes the publish rule in `publish()`/`canPublish` (empty content cannot publish), so the DTO merely stops pre-empting that rule. This keeps business rules in the entity (constitution II) and the client's "Publish" action as a single request.

**Alternatives considered**: always create-as-draft then a separate `publish` call for the compose flow (two round-trips for the common case); an explicit `status` field in the DTO (rejected — leaks lifecycle control past the entity's `publish()` method).

---

## 9. Editing media

**Decision**: Extend `UpdatePostDto` with an optional `assetIds?: string[]` (≤10, UUID-validated). Updating replaces the post's media attachments wholesale (the client submits the full ordered list). The service rebuilds the `PostAsset` rows (`assetId` + `displayOrder` = index) and re-saves. `content` remains independently optional.

**Rationale**: FR-008 requires editing text **and** media. Replace-all semantics are simplest and unambiguous (the compose UI always holds the full current attachment list).

**Alternatives considered**: per-asset add/remove/reorder operations (more endpoints and client state machines than the requirement justifies); ignoring media edits (rejected — contradicts FR-008).

---

## 10. Author summary in post responses

**Decision**: Add an `author` summary (`{ id, username, displayName, avatarUrl }`) to `IPostResponse`/`PostResponseDto`, populated from the already-joined `Post.author` (`UserProfile`) relation. The `id` is the author's `authUserId` (the value `Post.authorId` holds).

**Rationale**: FR-001 requires showing the author; the raw UUID is unusable in the UI. The repository already joins `author` on every post read, so this is a projection, not a new query.

**Alternatives considered**: a separate `/profiles/:id` lookup per post on the client (rejected — N+1 and unnecessary); exposing the full `UserProfile` (rejected — leaks `authUserId`-adjacent internals; a summary is the right wire shape).

---

## 11. Security fixes (unguarded mutations + ForbiddenException)

**Decision**: (a) Add `@UseGuards(JwtAuthGuard)` to `PATCH /posts/:id`, `POST /posts/:id/publish`, `POST /posts/:id/archive`, and `DELETE /posts/:id`. (b) Replace `ForbiddenException` ownership checks in `posts.service.ts` and `comments.service.ts` with `UnauthorizedError` from `@repo/shared` (mapped to 401 by `DomainExceptionFilter`).

**Rationale**: These routes read `@CurrentUser('sub')` but are unauthenticated today, so `userId` is `undefined` and the ownership checks cannot work (constitution V violation). The `ForbiddenException` usages violate constitution IV (domain code must not throw framework exceptions). Both are minimal, in-place corrections.

**Alternatives considered**: leaving as-is (rejected — the IDOR protection is non-negotiable and currently non-functional); a global guard (rejected — `GET /posts/:id`, `search`, and `Discover` reads may remain public).

---

## 12. Frontend architecture

**Decision**: Extend the existing App Router app rather than restructure. New routes: `/compose` (post form + media upload + publish/save-draft), `/posts/[id]` (post detail + comments + like/share/repost + gallery), `/search` (search UI). The Home feed (`/`) gains Following/Discover tabs plus sort and media-type controls. New components under `components/posts/` (`PostForm`, `PostActions`, `MediaGallery`, `Comments`) and enrichment of `components/feed/`. `lib/api/` gains `posts.ts`, `likes.ts`, `reposts.ts`, `comments.ts`, `assets.ts`, `search.ts` (typed against `@repo/contracts`, reusing the existing `coreApi` client). Share = client-side `navigator.share` with a clipboard fallback; re-post = the backend endpoint.

**Rationale**: Matches the `001` pattern (App Router routes + `components/*` + `lib/api/*`), reuses TanStack Query (mutation + invalidation for like/comment/repost feedback), and keeps the client coupled to `@repo/contracts` only (constitution III).

**Alternatives considered**: a post detail modal instead of a route (works but hurts deep-linking and share-link UX — the spec's "copy link" implies a stable URL, so a route is chosen); a state library (rejected — React Query + context suffice).

---

## 13. Contract additions (`@repo/contracts`)

**Decision**: Extend `posts` and add `requests.ts` for the post/feed query shapes, mirroring the `profiles`/`follows` layout. New types: `IAuthorSummary`, `IPostResponse` (engagement fields + author), `IPostMediaResponse`, `IRepostResponse`, `IFeedItem` (`IPostResponse | IRepostResponse`), `IFeedResponse`, `IPostFeedQuery`, `PostSort`, `MediaTypeFilter`, `FeedType`. Backend DTOs `implements` these (matching `ProfileResponseDto implements IProfileResponse`). The client imports them only.

**Rationale**: Constitution III — wire shapes live once in `@repo/contracts`; backend DTOs link to them; the client never re-declares them.

**Alternatives considered**: leave shapes in the backend DTOs and duplicate in the client (rejected — violates constitution III and the "no duplication" assumption).

---

## 14. Testing strategy

**Decision**: Jest entity specs for new domain rules (`Post.publish`/`archive`, `PostLike.create`, `Repost.create` idempotency/guards) and service/controller specs for like/repost/feed/sort/filter/ownership paths, mirroring the existing `*.spec.ts` layout. Client: component/unit specs with Jest + React Testing Library for the new `PostCard`, `PostForm`, `Comments`, and sort/filter controls. `turbo run build` remains the type gate.

**Rationale**: CI runs core unit tests + `turbo run build`; new backend logic must be covered by specs. The feed query (sort/filter/counts) is the highest-risk area and gets focused service/repository specs.

**Alternatives considered**: e2e harness (valuable but deferred; documented in [quickstart.md](./quickstart.md) as manual validation scenarios).

---

## 15. Open items (non-blocking, deferred)

- Comment **likes** (entity/table exist; no FR requires the feature).
- Token refresh-on-401 in the client (deferred from `001`).
- Real-time/push updates to the feed.
- Full-text search (current `ILIKE '%kw%'` is adequate for SC-008; a Postgres `tsvector`/GIN index is a later optimization if scale demands it).
- Notification events for like/repost/comment (out of scope; the notifications consumer is untouched).
