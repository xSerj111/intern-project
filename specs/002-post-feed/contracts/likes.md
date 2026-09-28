# Likes Contract

**Endpoints** (core_microservice, port 3001): `POST /posts/:id/like`, `DELETE /posts/:id/like`

Both are JWT-guarded and idempotent (the unique `(postId, userId)` index makes double-like/unlike a no-op).

## `POST /posts/:id/like`

- Auth: `Authorization: Bearer <jwt>`.
- Response 200: the updated engagement state (or 204). The client may refetch the post/feed to read `likeCount` + `likedByMe`.

## `DELETE /posts/:id/like`

- Auth required; idempotent.

## Response shape

No dedicated like resource is returned; the authoritative state is `IPostResponse.likeCount` and `IPostResponse.likedByMe` (see [post.md](./post.md)). Like/unlike endpoints return HTTP 2xx and the client invalidates the feed/post query.

## Error responses

| Status | Condition |
|--------|-----------|
| 401 | Missing/invalid JWT |
| 404 | Post not found |
