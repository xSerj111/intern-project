# Data Model: Post Feed

**Feature**: `002-post-feed` | **Date**: 2026-09-28

Backend persistence is owned by `core_microservice` (`innogram_core`). This document describes the **domain entities** (existing and new), their **fields/relationships**, **state transitions**, and **validation rules** that this feature introduces or changes. Wire shapes are defined in [contracts/](./contracts/README.md); the client owns no database (its conceptual/session model is unchanged from `001-client-app-baseline`).

---

## 1. Entities

### 1.1 Post (existing — extended projection only)

Central content unit. **No schema change**; the changes are to the *response projection* (engagement + author) and to DTO validation, not to columns.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | from `TypeormEntityBase` |
| authorId | uuid FK → `user_profiles.authUserId` | logical owner (the auth user) |
| content | text | ≤ 500 chars; **now optional at create** (drafts may be empty) |
| status | enum `draft`/`published`/`archived` | lifecycle (see §3) |
| assets | PostAsset[] | ordered attachments (≤ 10) |
| comments | Comment[] | cascade on hard-delete |
| createdAt / updatedAt / deletedAt | timestamps | soft-delete via `deletedAt` |

**Business rules (entity methods — constitution II)**:
- `static create({ authorId, content, assets? })` → always `Draft`.
- `canPublish` = status is `draft` **and** `content.trim().length > 0`.
- `publish()` throws `InvalidPostStateError` unless `canPublish` (enforces FR-007).
- `canArchive` = status is `published`; `archive()` throws `PostArchiveError` otherwise.

**Validation (DTO layer)**:
- `CreatePostDto`: `content` optional (≤ 500); `assetIds` optional array (≤ 10, UUID-validated); `publish?` boolean (default false).
- `UpdatePostDto`: `content` optional (≤ 500); `assetIds` optional array (≤ 10) — replace-all semantics.

### 1.2 Media Asset (existing)

An uploaded image/video stored in MinIO and referenced by posts.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| uploaderId | uuid | logical owner |
| url | varchar | public S3/MinIO URL |
| mimeType | varchar(100) | e.g. `image/jpeg`; **authoritative media-type source** |
| size | int | bytes |
| createdAt / updatedAt / deletedAt | timestamps | |

- **No `type` column** (dropped in migration `AddAssetsTable`). Media type is **derived** from `mimeType` (`image/*` → `photos`, `video/*` → `videos`).
- Upload validation: ≤ 10 MB **and** MIME in whitelist (`image/jpeg|png|gif|webp`, `video/mp4|webm|quicktime`). Unsupported → HTTP 400 (FR-006).

### 1.3 PostAsset (join — existing)

Ordered association between a post and an asset.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| postId | uuid FK → posts (CASCADE) | |
| assetId | uuid FK → assets (CASCADE) | |
| displayOrder | int | ascending carousel order (index of selection) |
| createdAt | timestamp | |

Unique `(postId, assetId)`.

### 1.4 PostLike (existing table — now exercised)

A user's like on a post. Table exists (migration `AddExplicitLikes`); this feature adds the port/adapter/service/controller layer and a `static create(postId, userId)` factory.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| postId | uuid FK → posts (CASCADE) | |
| userId | uuid | logical liker (auth user) |
| createdAt | timestamp | |
| deletedAt | timestamp | soft-delete (unlike) |

- Unique `(postId, userId)` — idempotent like; concurrent double-likes resolve to one row.
- `likeCount` = count of non-deleted rows for a post; `likedByMe` = exists a non-deleted row for `(post, viewer)`.

### 1.5 Repost (NEW)

A user's re-post of an existing published post to their own feed, retaining attribution to the original author.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| originalPostId | uuid FK → posts (CASCADE) | the post being re-posted |
| authorId | uuid | the re-poster (auth user) |
| createdAt / updatedAt / deletedAt | timestamps | soft-delete (un-repost) |

- `static create(originalPostId, authorId)` factory.
- Uniqueness: a user may re-post a given post at most once (guard/index on `(originalPostId, authorId)`).
- Business rule: only **published** posts can be re-posted (draft/archived/deleted originals are rejected).
- Deletion semantics (FR-027): the repost references the original post; if the original is soft-deleted, the feed renders a "post unavailable" placeholder (`post: null`) rather than dropping the item.

### 1.6 Comment (existing)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| postId | uuid FK → posts (CASCADE) | |
| parentId | uuid FK → comments (nullable, CASCADE) | nested replies |
| authorId | uuid FK → user_profiles | |
| content | text | ≤ 300 chars; `edit()` enforces non-empty |
| createdAt / updatedAt / deletedAt | timestamps | |

- `commentCount` = count of non-deleted comments for a post.

### 1.7 User (Author) — referenced, not redefined

The author of a post/comment/repost is the existing `UserProfile` (keyed by `authUserId`), surfaced in responses as an **`IAuthorSummary`** (`{ id, username, displayName, avatarUrl }`), not a new entity.

---

## 2. Relationships

```
UserProfile (author)
   └──< Post (authorId -> authUserId)        1..N posts
          ├──< PostAsset >── Asset            1..N ordered media
          ├──< PostLike                       1..N likes (unique per user)
          ├──< Comment                        1..N comments (self-parent for replies)
          └──< Repost (originalPostId)        1..N re-posts by other users
```

- `Post.author` is joined on every post read (repository default relations `['author','assets']`), so the author summary and media URLs are projections, not extra round-trips.
- `Repost` is a distinct aggregate referencing `Post`; it is **not** a lifecycle state of `Post`.

---

## 3. State transitions

### 3.1 Post lifecycle (FR-004, 007, 008, 024–027)

```
        create (publish:false)          publish() [content non-empty]
 (none) ───────────────────────▶ draft ─────────────────────────────▶ published
                                       ◀─────────────────────────────  archive()
                                        publish() [content empty] throws InvalidPostStateError

        published ──archive()──▶ archived ──(no re-publish in scope)
        any ──delete()──▶ soft-deleted (deletedAt set; hidden from all feeds)
```

- Delete is **soft** (`softDelete`), so reposts can still resolve (and render "post unavailable").
- Comments/likes of a soft-deleted post are no longer reachable: reads that surface a post filter `deletedAt IS NULL`, and `GET /comments/post/:postId` returns empty/404 for a deleted post.

### 3.2 Like (FR-011)

```
(no like) ──POST /posts/:id/like──▶ liked ──DELETE /posts/:id/like──▶ (no like)
              (idempotent)                       (idempotent)
```

### 3.3 Repost (FR-014, 027)

```
(no repost) ──POST /posts/:id/repost──▶ reposted ──DELETE /posts/:id/repost──▶ (no repost)
             (original must be published; idempotent)
```

---

## 4. Feed query model (derived — no new entity)

`GET /posts/feed` returns a flat list of **feed items**, each either a `Post` or a `Repost`, merged and ordered by the selected sort:

| Param | Values | Effect |
|-------|--------|--------|
| `feed` | `following` (default) / `discover` | author set: followed+self vs. all public |
| `sort` | `newest` (default) / `oldest` / `most_liked` | `createdAt DESC` / `createdAt ASC` / like-count DESC |
| `mediaType` | `photos` / `videos` / `text` (optional) | posts with image asset / video asset / no assets |
| `page` / `limit` | ints | offset pagination |

- `following` author set = `[own authUserId] ∪ followingIds`; `discover` = no author filter.
- Repost items appear when the **re-poster** is in the author set (following feed) or always (discover), and embed the original post.
- Only `published` posts are ever emitted.

---

## 5. Validation rules (summary)

| Rule | Enforced at | Source |
|------|-------------|--------|
| Post content ≤ 500 chars | DTO `@MaxLength(500)` | spec assumption |
| Publish requires non-empty content | entity `publish()` | FR-007 |
| ≤ 10 media items/post | DTO `@ArrayMaxSize(10)` | spec assumption |
| File ≤ 10 MB | `MaxFileSizeValidator` | FR-006 / assumption |
| File type image/video only | new MIME whitelist validator | FR-006 |
| Comment content non-empty, ≤ 300 | entity `edit()` + `@MaxLength(300)` | existing |
| Search keyword ≥ 3 chars | `SearchQueryDto @MinLength(3)` | FR-022 |
| Only author may edit/archive/delete/repost-delete | service ownership check (`user.sub === authorId`) | FR-010 / constitution V |
