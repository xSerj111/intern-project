# Post Contract

**Service**: `core_microservice` (port 3001). All mutating endpoints are JWT-guarded and verify ownership.

## Shared types (additions to `@repo/contracts/posts`)

```ts
// posts/responses.ts

/** Lifecycle status (existing). */
export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
  Archived = 'archived',
}

/** Compact author projection. `id` is the author's `authUserId`. */
export interface IAuthorSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Derived media kind. */
export type MediaKind = 'image' | 'video';

/** A single media attachment, in display order. */
export interface IPostMediaResponse {
  assetId: string;
  url: string;
  mimeType: string;       // e.g. image/jpeg
  mediaType: MediaKind;   // derived from mimeType
  displayOrder: number;
}

export interface IPostResponse {
  id: string;
  author: IAuthorSummary;      // NEW — was authorId: string
  content: string;
  status: PostStatus;
  assets: IPostMediaResponse[]; // was IPostAssetResponse[] (assetId+displayOrder only)
  likeCount: number;            // NEW
  commentCount: number;         // NEW
  repostCount: number;          // NEW
  likedByMe: boolean;           // NEW — false for unauthenticated reads
  createdAt: string;
  updatedAt: string;
}
```

## Endpoints

### `POST /posts` — create (draft or publish)

Request (`posts/requests.ts`):

```ts
export interface ICreatePostRequest {
  content?: string;       // optional — empty allowed for drafts; ≤ 500
  assetIds?: string[];    // optional; ≤ 10 UUIDs
  publish?: boolean;      // optional; default false → draft
}
```

- Auth: `Authorization: Bearer <jwt>`.
- `publish: true` with empty content → HTTP 400 (`InvalidPostStateError`).

### `GET /posts/:id` — read one

Public. Returns `IPostResponse` (with `likedByMe: false`).

### `PATCH /posts/:id` — edit (own posts only)

Request:

```ts
export interface IUpdatePostRequest {
  content?: string;       // ≤ 500
  assetIds?: string[];    // replace-all; ≤ 10
}
```

- Auth required. Non-author → HTTP 401 (`UnauthorizedError`).

### `POST /posts/:id/publish` — publish a draft

- Auth required, author only. Non-draft/empty → HTTP 400.

### `POST /posts/:id/archive` — archive a published post

- Auth required, author only. Non-published → HTTP 400.

### `DELETE /posts/:id` — delete

- Auth required, author only. Confirmation is a client concern. Soft-deletes the post (hidden everywhere); reposts of it render "post unavailable".

## Error responses

| Status | Condition |
|--------|-----------|
| 400 | Validation error; invalid state transition (empty publish, archive non-published) |
| 401 | Missing/invalid JWT, or not the author |
| 404 | Post not found |
