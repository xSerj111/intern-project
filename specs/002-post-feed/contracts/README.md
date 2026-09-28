# Contracts — Post Feed

This directory documents the **interface contracts** the post-feed feature exposes. These are wire-format request/response shapes, defined once in `packages/contracts` (`@repo/contracts`) and shared with the backend rather than duplicated in the client (constitution III).

- The client imports these types from `@repo/contracts` only — never from `@repo/shared`.
- Backend DTOs (`core_microservice`) `implements` the corresponding interfaces, following the existing `ProfileResponseDto implements IProfileResponse` precedent.
- Dates are serialized as ISO 8601 strings over the wire.
- Enum-like values (`PostStatus`, `PostSort`, `MediaTypeFilter`, `FeedType`) are string literal unions / enums defined in `@repo/contracts` and mirrored by the backend.

| Contract file | Endpoint(s) | Status |
|---------------|-------------|--------|
| [post.md](./post.md) | `POST /posts`, `GET /posts/:id`, `PATCH /posts/:id`, `POST /posts/:id/publish`, `POST /posts/:id/archive`, `DELETE /posts/:id` | extended — engagement + author + media edit + optional content |
| [feed.md](./feed.md) | `GET /posts/feed` | extended — `feed`/`sort`/`mediaType` params, `IFeedItem` union |
| [likes.md](./likes.md) | `POST /posts/:id/like`, `DELETE /posts/:id/like` | **new** |
| [reposts.md](./reposts.md) | `POST /posts/:id/repost`, `DELETE /posts/:id/repost` | **new** |
| [comments.md](./comments.md) | `POST /comments`, `GET /comments/post/:postId`, `PATCH /comments/:id`, `DELETE /comments/:id` | existing — documented for the client |
| [assets.md](./assets.md) | `POST /assets/upload` | existing — MIME whitelist added |
| [search.md](./search.md) | `GET /posts/search` | existing — documented for the client |

> The backend response shapes are authoritative (the client does not re-declare them). Where a backend DTO already defines a shape (e.g. `PostResponseDto`), the contract mirrors it exactly — with the fields this feature adds.
