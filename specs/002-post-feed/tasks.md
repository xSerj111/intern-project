# Tasks: Post Feed

**Input**: Design documents from `/specs/002-post-feed/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. `plan.md` (Technical Context → Testing) and `research.md` §14 explicitly require entity/service/controller specs for the new domain logic (post status transitions, like idempotency, repost) and feed/sort/filter paths, and the constitution mandates unit specs alongside code (CI runs `core_microservice` unit tests). Client component specs are noted but lightweight.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US7)
- Exact file paths included in every task description.

---

## Phase 1: Setup (Shared Infrastructure — `@repo/contracts` wire types)

**Purpose**: Define the wire-format types both backend DTOs (`implements`) and the client (`imports`) depend on. Per constitution III, these live once in `@repo/contracts` — never duplicated in the client and never placed in `@repo/shared`.

- [X] T001 [P] Create `packages/contracts/src/posts/requests.ts` with `ICreatePostRequest` (`content?: string` ≤500, `assetIds?: string[]` ≤10, `publish?: boolean`), `IUpdatePostRequest` (`content?: string`, `assetIds?: string[]`), `IPostFeedQuery` (`feed?`, `sort?`, `mediaType?`, `page?`, `limit?`), and `ISearchPostsQuery` (`keyword`, `page?`, `limit?`)
- [X] T002 [P] Extend `packages/contracts/src/posts/responses.ts`: add `IAuthorSummary` (`id`, `username`, `displayName`, `avatarUrl: string | null`), `MediaKind` (`'image' | 'video'`), `IPostMediaResponse` (`assetId`, `url`, `mimeType`, `mediaType`, `displayOrder`), `FeedType` (`'following' | 'discover'`), `PostSort` (`'newest' | 'oldest' | 'most_liked'`), `MediaTypeFilter` (`'photos' | 'videos' | 'text'`), `IRepostResponse` (`id`, `repostAuthor: IAuthorSummary`, `post: IPostResponse | null`, `createdAt`), `IFeedItem = IPostResponse | IRepostResponse`, and `ISearchResponse`; extend `IPostResponse` to replace `authorId` with `author: IAuthorSummary`, replace `assets?: IPostAssetResponse[]` with `assets?: IPostMediaResponse[]`, and add `likeCount`, `commentCount`, `repostCount`, `likedByMe`; update `IFeedResponse.items` to `IFeedItem[]`
- [X] T003 [P] Create `packages/contracts/src/comments/` (`responses.ts`, `requests.ts`, `index.ts`) with `ICommentResponse` (`id`, `postId`, `parentId: string | null`, `author: IAuthorSummary`, `content`, `createdAt`, `updatedAt`), `ICreateCommentRequest` (`postId`, `content` non-empty ≤300, `parentId?`), and `IUpdateCommentRequest` (`content?`)
- [X] T004 Update `packages/contracts/src/posts/index.ts` (export `./requests`) and `packages/contracts/src/index.ts` (export `./comments`), then build upstream packages: `npm run build -w @repo/contracts -w @repo/shared`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend entities/repositories/security that multiple user stories depend on. No user story can begin until these are complete.

**⚠️ CRITICAL**: Like/unlike (US3), repost (US3), engagement counts (US1), and every mutating endpoint (US2/US3/US4) depend on this phase.

- [X] T005 Create `Repost` entity in `apps/core_microservice/src/modules/posts/domain/entities/repost.entity.ts`: fields `id` (uuid PK, from `TypeormEntityBase`), `originalPostId` (uuid FK → posts, CASCADE), `authorId` (uuid, the re-poster), `createdAt`/`updatedAt`/`deletedAt` (soft-delete); `@Index(['originalPostId', 'authorId'], { unique: true })`; `static create(originalPostId, authorId)` factory
- [X] T006 Create migration `apps/core_microservice/src/migrations/<timestamp>-AddReposts.ts` for the `reposts` table (mirrors T005 columns + unique index); run `npm run migration:run -w core_microservice`
- [X] T007 [P] Create `apps/core_microservice/src/modules/posts/domain/interfaces/repost-repository.port.ts` with `RepostProps` and `IRepostRepository extends RepositoryPort<Repost, RepostProps>` exposing `findByOriginalAndAuthor`, `findByAuthor`, `countByOriginalPostIds`; export `RepostRepositoryKey = Symbol.for('IRepostRepository')`
- [X] T008 [P] Add `static create(postId: string, userId: string): PostLike` factory to `apps/core_microservice/src/modules/posts/domain/entities/post-like.entity.ts`
- [X] T009 [P] Create `apps/core_microservice/src/modules/posts/infrastructure/repository/post-like.repository.ts` (`@Injectable()` `PostLikeRepository` over the existing `post_likes` table) with `like(postId, userId)`, `unlike(postId, userId)`, `findByPostAndUser`, `countByPostIds` (non-deleted), `existsByPostAndUser`
- [X] T010 Create `apps/core_microservice/src/modules/posts/infrastructure/repository/repost.repository.ts` (`RepostRepository extends TypeormRepositoryBase<Repost, RepostProps> implements IRepostRepository`) (depends on T005, T007)
- [X] T011 [P] Create `apps/core_microservice/src/modules/posts/domain/errors/post.errors.ts` with a `RepostNotAllowedError extends DomainError` (thrown when the original post is not `published`) — reuse existing `InvalidPostStateError`/`PostArchiveError` from `post.entity.ts` where applicable
- [X] T012 Add `@UseGuards(JwtAuthGuard)` to `PATCH /posts/:id`, `POST /posts/:id/publish`, `POST /posts/:id/archive`, and `DELETE /posts/:id` in `apps/core_microservice/src/modules/posts/posts.controller.ts` (these currently read `@CurrentUser('sub')` unauthenticated — constitution V)
- [X] T013 [P] Migrate `ForbiddenException` → `UnauthorizedError` (from `@repo/shared`) in the four ownership checks in `apps/core_microservice/src/modules/posts/posts.service.ts` (update/delete/publish/archive)
- [X] T014 [P] Migrate `ForbiddenException` → `UnauthorizedError` in the two ownership checks in `apps/core_microservice/src/modules/comments/comments.service.ts` (update/delete)
- [X] T015 Register `Repost`, `PostLikeRepository`, and `RepostRepository` in `apps/core_microservice/src/modules/posts/posts.module.ts` (`TypeOrmModule.forFeature` + `providers`); bind `RepostRepositoryKey` if the service will use the port symbol
- [X] T016 [P] Add `apps/core_microservice/src/modules/posts/domain/entities/repost.entity.spec.ts` covering `Repost.create` and the uniqueness/soft-delete behavior, and extend `post-like.entity.spec.ts` (create alongside `post-like.entity.ts`) covering `PostLike.create`

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — View the post feed (Priority: P1) 🎯 MVP

**Goal**: Signed-in users see a scrollable, paginated feed. Default "Following" shows published posts from followed accounts + own posts; "Discover" shows all public posts. Each item shows author, text, media, and engagement (like/comment/repost counts + `likedByMe`).

**Independent Test**: Sign in, open the feed, switch Following/Discover, and confirm posts render with author/text/media/engagement and additional posts load on scroll.

### Implementation for User Story 1

- [X] T017 [P] [US1] Extend `apps/core_microservice/src/modules/posts/dto/feed-query.dto.ts` with `feed?: 'following' | 'discover'` (default `following`) — leave `page`/`limit` as-is
- [X] T018 [P] [US1] Extend `apps/core_microservice/src/modules/posts/dto/post-response.dto.ts`: replace `authorId` with an `author: IAuthorSummary` projection (from the joined `Post.author` `UserProfile`: `id` = `authUserId`, `username`, `displayName`, `avatarUrl`), change `assets` to `IPostMediaResponse[]` (add `url`, `mimeType`, and `mediaType` derived from `mimeType`: `image/*` → `'image'`, `video/*` → `'video'`), and add `likeCount`, `commentCount`, `repostCount`, `likedByMe`
- [X] T019 [US1] Extend `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts` with a `getFeed` that supports `feed: 'discover'` (no author filter, `status: Published`) vs `'following'` (author in `[self ∪ followingIds]`), ordered `createdAt DESC`, and returns engagement counts via batched aggregate queries (`COUNT` over `post_likes`/`comments`/`reposts` where not soft-deleted) — no N+1 (depends on T009, T010)
- [X] T020 [US1] Extend `apps/core_microservice/src/modules/posts/posts.service.ts` `getFeed(userId, feed, page, limit)` to compute the following author set via `followRepository.findFollowing`, call the extended repository, and attach engagement counts + `likedByMe` (true when the viewer has a non-deleted `post_likes` row)
- [X] T021 [US1] Extend `apps/core_microservice/src/modules/posts/posts.controller.ts` `GET /posts/feed` to pass `feed` and return `IFeedResponse` (items shaped by the extended `PostResponseDto`)
- [X] T022 [US1] Extend `apps/core_microservice/src/modules/posts/posts.service.spec.ts` with feed coverage: `following` vs `discover` author set, engagement counts, and `likedByMe`
- [X] T023 [P] [US1] Extend `apps/client_app/src/lib/api/feed.ts` `getFeed` to accept and pass `feed`, `sort`, `mediaType`, `page`, `limit` and return `IFeedResponse`
- [X] T024 [P] [US1] Extract a `PostCard` component into `apps/client_app/src/components/feed/post-card.tsx` rendering `IPostResponse`: author name/handle + avatar, text, inline media thumbnails (via `IPostMediaResponse.url`), and like/comment/repost counts
- [X] T025 [US1] Update `apps/client_app/src/components/feed/feed-list.tsx` to use the new `PostCard` and `useInfiniteQuery` for progressive pagination (`page`/`limit`), removing the inline `PostCard`
- [X] T026 [US1] Update `apps/client_app/src/app/page.tsx` to render Following/Discover feed tabs (state toggling the `feed` param) with the existing error/retry + empty states

**Checkpoint**: User Story 1 fully functional and independently testable.

---

## Phase 4: User Story 2 — Create and publish a post with media (Priority: P1) 🎯 MVP

**Goal**: Compose text + optional images/videos; publish immediately or save as draft; media uploads with progress/errors; empty publish blocked.

**Independent Test**: Sign in, open compose, add text + media, publish, and confirm the post appears in the feed with media.

### Implementation for User Story 2

- [X] T027 [P] [US2] Relax `apps/core_microservice/src/modules/posts/dto/create-post.dto.ts`: make `content` optional (`@IsOptional`, keep `@MaxLength(500)`), and add `publish?: boolean` (default `false`)
- [X] T028 [US2] Extend `apps/core_microservice/src/modules/posts/posts.service.ts` `createPost` to honor `publish`: when `publish: true`, call `post.publish()` before save (which throws `InvalidPostStateError` for empty content → HTTP 400, enforcing FR-007)
- [X] T029 [P] [US2] Harden `apps/core_microservice/src/modules/assets/assets.controller.ts` upload with a MIME whitelist validator (`image/jpeg|image/png|image/gif|image/webp|video/mp4|video/webm|video/quicktime`) alongside the existing 10 MB `MaxFileSizeValidator`; unsupported type → HTTP 400
- [X] T030 [US2] Extend `apps/core_microservice/src/modules/posts/posts.service.spec.ts` to cover create-with-publish vs draft and the empty-publish rejection
- [X] T031 [P] [US2] Create `apps/client_app/src/lib/api/assets.ts` with `uploadAsset(file, token, onProgress?)` using `FormData` + `coreApi` against `POST /assets/upload`, returning `IAssetResponse`
- [X] T032 [P] [US2] Create `apps/client_app/src/lib/api/posts.ts` with `createPost(token, ICreatePostRequest)` against `POST /posts`
- [X] T033 [US2] Create `apps/client_app/src/components/posts/post-form.tsx` (compose form): text area (≤500 chars counter), media picker (≤10 items), upload progress/error UI (rejecting >10 MB or non-image/video with a friendly message per FR-006), and Publish / Save-draft actions (disable Publish when no text and no media — FR-007)
- [X] T034 [US2] Create `apps/client_app/src/app/compose/page.tsx` route that renders `PostForm` and redirects to the feed after a successful publish

**Checkpoint**: Create-and-publish loop works end-to-end; MVP (US1 + US2) is shippable.

---

## Phase 5: User Story 3 — Interact with posts: like, comment, share (Priority: P2)

**Goal**: Like/unlike, comment CRUD + display, copy-link/native share, and re-post with attribution.

**Independent Test**: Like/unlike a post (state + count consistent), post and view comments, copy link / native share, and re-post so it appears in the feed with attribution.

### Implementation for User Story 3

- [X] T035 [P] [US3] Create `apps/core_microservice/src/modules/posts/infrastructure/repository/post-like.repository.ts` `like`/`unlike` idempotency wiring (unique `(postId, userId)` index makes double-like/unlike a no-op) — finalize if only stubbed in T009
- [X] T036 [US3] Add `POST /posts/:id/like` and `DELETE /posts/:id/like` (JWT-guarded) in `apps/core_microservice/src/modules/posts/posts.controller.ts`, delegating to `posts.service.ts` `likePost(userId, id)` / `unlikePost(userId, id)`
- [X] T037 [US3] Add `POST /posts/:id/repost` and `DELETE /posts/:id/repost` (JWT-guarded) in `apps/core_microservice/src/modules/posts/posts.controller.ts`, delegating to `posts.service.ts` `repost(userId, id)` / `unrepost(userId, id)`; repost of a non-`published` post throws `RepostNotAllowedError` (HTTP 400)
- [X] T038 [US3] Implement `likePost`/`unlikePost`/`repost`/`unrepost` in `apps/core_microservice/src/modules/posts/posts.service.ts` using `PostLikeRepository`/`RepostRepository` (idempotent, ownership not required for like/repost, but 404 when post missing)
- [X] T039 [US3] Extend `apps/core_microservice/src/modules/posts/posts.service.ts` feed to include re-post items as `IRepostResponse` (original post embedded + `repostAuthor`; original soft-deleted → `post: null`), so re-posts surface in the Following/Discover feeds (FR-014, FR-027)
- [X] T040 [P] [US3] Extend `apps/core_microservice/src/modules/comments/dto/comment-response.dto.ts` to replace `authorId` with `author: IAuthorSummary` (from the already-joined `Comment.author`)
- [X] T041 [US3] Extend `apps/core_microservice/src/modules/posts/posts.service.spec.ts` and `posts.controller.spec.ts` with like/unlike + repost/unrepost coverage (idempotency, non-published repost rejection, guards present)
- [X] T042 [P] [US3] Create `apps/client_app/src/lib/api/likes.ts` (`likePost`, `unlikePost`), `apps/client_app/src/lib/api/reposts.ts` (`repostPost`, `unrepostPost`), and `apps/client_app/src/lib/api/comments.ts` (`createComment`, `getCommentsByPost`, `updateComment`, `deleteComment`)
- [X] T043 [US3] Create `apps/client_app/src/components/posts/post-actions.tsx` with like (toggle + count, TanStack Query mutation + invalidate), comment count, share (copy link via `navigator.clipboard` + native `navigator.share` fallback), and re-post actions
- [X] T044 [US3] Create `apps/client_app/src/components/posts/comments.tsx` (list + add + edit + delete comment, author shown) wired to the comments API
- [X] T045 [US3] Create `apps/client_app/src/app/posts/[id]/page.tsx` post-detail route rendering the post, `PostActions`, and `Comments`

**Checkpoint**: Interaction loop works; like/comment/repost state consistent.

---

## Phase 6: User Story 4 — Edit, archive, and delete own posts (Priority: P2)

**Goal**: Edit text + media of own posts, archive (hide from feeds), delete with confirmation; not offered on others' posts.

**Independent Test**: Edit own post text/media (persists), archive (hidden from feeds), delete with confirm (removed + reposts show "post unavailable"), and confirm actions are absent on others' posts.

### Implementation for User Story 4

- [X] T046 [P] [US4] Extend `apps/core_microservice/src/modules/posts/dto/update-post.dto.ts` with `assetIds?: string[]` (`@ArrayMaxSize(10)`, `@IsUUID('4', { each: true })`) — replace-all media semantics
- [X] T047 [US4] Extend `apps/core_microservice/src/modules/posts/posts.service.ts` `updatePost` to rebuild `PostAsset` rows (`assetId` + `displayOrder` = index) when `assetIds` is provided; keep the `UnauthorizedError` ownership check (from T013)
- [X] T048 [P] [US4] Extend `apps/core_microservice/src/modules/posts/posts.service.spec.ts` with edit-media replace-all and non-author denial coverage
- [X] T049 [P] [US4] Create `apps/client_app/src/lib/api/posts.ts` helpers `updatePost`, `deletePost`, `archivePost`, `publishPost` against the existing endpoints
- [X] T050 [US4] Update `apps/client_app/src/components/posts/post-form.tsx` to support edit mode (prefill text/media, submit `PATCH /posts/:id` with full `assetIds` list)
- [X] T051 [US4] Update `apps/client_app/src/app/posts/[id]/page.tsx` with owner-only Edit / Archive / Delete actions; Delete shows a confirmation prompt; hidden entirely for non-authors

**Checkpoint**: Ownership controls complete (edit/archive/delete own only).

---

## Phase 7: User Story 5 — View post media in a gallery/lightbox (Priority: P2)

**Goal**: Inline media renders; selecting opens full-screen gallery with prev/next navigation and video playback; text-only posts render cleanly.

**Independent Test**: Open a post with multiple images/videos, open gallery, navigate, play video.

### Implementation for User Story 5

- [X] T052 [P] [US5] Create `apps/client_app/src/components/posts/media-gallery.tsx` (lightbox): full-screen overlay, prev/next navigation, and `<video controls>` playback for `mediaType === 'video'`
- [X] T053 [US5] Wire `MediaGallery` into `apps/client_app/src/components/feed/post-card.tsx` (open on media click) and `apps/client_app/src/app/posts/[id]/page.tsx`; ensure text-only posts render without media placeholders (FR-016)

**Checkpoint**: Gallery/lightbox works in feed and detail views.

---

## Phase 8: User Story 6 — Sort and filter the feed (Priority: P3)

**Goal**: Sort by newest/oldest/most-liked and filter by media type (photos/videos/text); clear restores default.

**Independent Test**: Change sort (oldest → most-liked) and apply media filter; feed updates to match; clearing restores newest full feed.

### Implementation for User Story 6

- [X] T054 [P] [US6] Extend `apps/core_microservice/src/modules/posts/dto/feed-query.dto.ts` with `sort?: 'newest' | 'oldest' | 'most_liked'` (default `newest`) and `mediaType?: 'photos' | 'videos' | 'text'`
- [X] T055 [US6] Extend `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts` to order by `createdAt DESC` / `ASC` / like-count `DESC` and filter by media type (`photos` → ≥1 image asset, `videos` → ≥1 video asset, `text` → no assets, derived from asset `mimeType`)
- [X] T056 [US6] Extend `apps/core_microservice/src/modules/posts/posts.service.ts` `getFeed` to pass `sort`/`mediaType` through; add spec coverage in `posts.service.spec.ts` for sort order and media-type filter
- [X] T057 [P] [US6] Update `apps/client_app/src/lib/api/feed.ts` to pass `sort`/`mediaType` (already parameterized in T023)
- [X] T058 [US6] Add sort + media-type filter controls to `apps/client_app/src/components/feed/feed-list.tsx` (or `page.tsx`) with an active-filter indicator and a Clear control (FR-017/018/019)

**Checkpoint**: Sort/filter works in under 2 s with clear reset.

---

## Phase 9: User Story 7 — Search for posts (Priority: P3)

**Goal**: Dedicated search interface returns matching posts; friendly no-results and min-length prompts.

**Independent Test**: Enter a keyword → matches appear; no matches → "no results"; <3 chars → prompt for longer term.

### Implementation for User Story 7

- [X] T059 [P] [US7] Confirm/extend `apps/core_microservice/src/modules/posts/dto/search-query.dto.ts` enforces `keyword` `@MinLength(3)` (FR-022) and `apps/core_microservice/src/modules/posts/infrastructure/repository/post.repository.ts` `searchPublishedPosts` returns the extended `IPostResponse` projection (author + engagement) — already extended in US1
- [X] T060 [P] [US7] Create `apps/client_app/src/lib/api/search.ts` (`searchPosts(keyword, page, limit)`) against `GET /posts/search` returning `ISearchResponse`
- [X] T061 [US7] Create `apps/client_app/src/app/search/page.tsx`: keyword input (≥3 chars prompt), paginated results reusing `PostCard`, and a friendly "no results" state (FR-020/021/022)

**Checkpoint**: Search works end-to-end.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Resilience, verification, and quality gates.

- [ ] T062 [P] Add client component specs (`@testing-library/react`) for `apps/client_app/src/components/feed/post-card.tsx`, `post-form.tsx`, `comments.tsx`, and sort/filter controls (mirrors `research.md` §14)
- [ ] T063 [P] Verify feed/error recovery: the feed uses the existing `ErrorState`/retry + `refetchInterval` from `apps/client_app/src/lib/query/provider.tsx` for FR-003 auto-recovery
- [ ] T064 Run `npm run lint` (apps), `npm run test -w core_microservice`, `npm run test -w client_app` (if configured), and `npm run build` (type-check surrogate) and fix failures
- [ ] T065 Walk through all 9 `quickstart.md` scenarios and record pass/fail

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 (contracts) — **BLOCKS all user stories**.
- **User Stories (Phases 3–9)**: All depend on Phase 2 completion. Run sequentially in priority order (US1 → US2 → … → US7) or in parallel if staffed.
- **Polish (Phase 10)**: Depends on the desired stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational only (needs `PostLikeRepository` + `RepostRepository` for counts). No story dependencies.
- **US2 (P1)**: Depends on Foundational only. Independent of US1 (both P1; US1 first for the surface).
- **US3 (P2)**: Depends on US1 (feed engagement + `IFeedItem`/`IRepostResponse` shaping) and Foundational (`PostLike`/`Repost` repos).
- **US4 (P2)**: Depends on US1 (extended `PostResponseDto`), Foundational (`UnauthorizedError`/guards), and US3 (detail page exists to host edit/delete).
- **US5 (P2)**: Depends on US1 (`PostCard` media rendering) and US3 (`posts/[id]` detail page).
- **US6 (P3)**: Depends on US1 (feed endpoint + `PostSort`/`MediaTypeFilter` contracts) and US3 (like counts exist for `most_liked`).
- **US7 (P3)**: Depends on US1 (extended `IPostResponse` projection).

### Within Each User Story

- Models/repositories before services; services before endpoints; backend before client (except where client work is contract-driven and parallelizable).

### Parallel Opportunities

- Phase 1: T001, T002, T003 are independent files — parallel.
- Phase 2: T007, T008, T009, T011, T013, T014, T016 are different files — parallel (after their entity prerequisites).
- US1: T017, T018, T023, T024 parallel; T022 (spec) parallel with implementation.
- US2: T027, T029, T031, T032 parallel.
- US3: T035, T040, T042 parallel.
- US6: T054, T057 parallel; US7: T059, T060 parallel.

---

## Parallel Example: User Story 1

```bash
# Contract-driven client + DTO work in parallel:
Task: "Extend apps/client_app/src/lib/api/feed.ts getFeed (feed/sort/mediaType)"
Task: "Extract PostCard in apps/client_app/src/components/feed/post-card.tsx"
Task: "Extend feed-query.dto.ts with feed param"
Task: "Extend post-response.dto.ts (author/engagement/media)"
```

---

## Implementation Strategy

### MVP First (User Story 1 + 2)

1. Phase 1 (contracts) + Phase 2 (foundational entities/repos/security).
2. Phase 3 (US1 — feed) → validate independently.
3. Phase 4 (US2 — create/publish) → **STOP and validate**: this is the minimal usable product.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 + US2 → test → deploy/demo (MVP).
3. US3 → US4 → US5 (interact + ownership + gallery) → test → deploy.
4. US6 → US7 (sort/filter + search) → test → deploy.
5. Polish (specs + lint/build + quickstart) → merge.

### Parallel Team Strategy

Once Foundational completes: Developer A → US1/US2 (P1), Developer B → US3 (P2), Developer C → US6/US7 (P3), with US4/US5 slotting in after US3.

---

## Notes

- `[P]` tasks touch different files — safe to parallelize.
- `[Story]` label maps each task to a user story for traceability.
- Every mutating endpoint must be JWT-guarded and verify ownership (constitution V).
- Domain errors must be `DomainError` subclasses — no `HttpException`/`ForbiddenException` from domain/services (constitution IV).
- Wire types go in `@repo/contracts` only; `class-validator` DTOs stay in module `dto/` (constitution III).
- Commit after each task or logical group (per `AGENTS.md`).
