# Comments Contract

**Service**: `core_microservice` (port 3001). Existing endpoints, documented here for the client.

## Shared type (additions to `@repo/contracts`)

```ts
export interface ICommentResponse {
  id: string;
  postId: string;
  parentId: string | null;
  author: IAuthorSummary;   // NEW — was authorId
  content: string;
  createdAt: string;
  updatedAt: string;
}
```

## Endpoints

### `POST /comments` — create

Request:

```ts
export interface ICreateCommentRequest {
  postId: string;      // UUID
  content: string;     // non-empty, ≤ 300
  parentId?: string;   // optional reply-to
}
```

Auth: `Authorization: Bearer <jwt>`. Returns `ICommentResponse`.

### `GET /comments/post/:postId` — list for a post

Public. Returns `ICommentResponse[]` (newest-first, author joined).

### `PATCH /comments/:id` — edit (author only)

Request: `{ content?: string }` (≤ 300). Auth required; non-author → 401.

### `DELETE /comments/:id` — delete (author only)

Auth required; non-author → 401. Returns 204.

## Error responses

| Status | Condition |
|--------|-----------|
| 400 | Empty/overlong content |
| 401 | Missing/invalid JWT, or not the author |
| 404 | Comment/post not found |
