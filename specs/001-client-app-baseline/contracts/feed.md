# Feed / Post Contract

**Endpoint**: `GET /posts/feed` (core_microservice, port 3001)

## Request

Query parameters (pagination), matching `FeedQueryDto`:

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | integer | 1 | `>= 1` |
| `limit` | integer | 20 | `>= 1` |

Authentication: the client sends `Authorization: Bearer <jwt>` (the feed is personalized to the caller + accounts they follow). The baseline adds `@UseGuards(JwtAuthGuard)` to this route so the authenticated id is available (see [research.md](../research.md) §3).

## Response (200)

```ts
// @repo/contracts — posts/responses.ts
export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
  Archived = 'archived',
}

export interface IPostAssetResponse {
  assetId: string;
  displayOrder: number;   // ascending sort order
}

export interface IPostResponse {
  id: string;
  authorId: string;
  content: string;
  status: PostStatus;
  assets?: IPostAssetResponse[];
  createdAt: string;      // ISO 8601
  updatedAt: string;      // ISO 8601
}

export interface IFeedResponse {
  items: IPostResponse[]; // NOTE: `items`, not `data` — matches GET /posts/feed
  total: number;
  page: number;
  limit: number;
}
```

> The generic `IPaginatedResponse<T>` uses a `data` field, but `GET /posts/feed` returns `items`. The client must read `items`. The `posts` contract therefore defines `IFeedResponse` with `items` rather than reusing `IPaginatedResponse<T>`.

## Client notes

- The client renders posts from `items` in the Home/Feed section.
- `status` filtering (e.g. showing only published posts) is a backend concern; the client renders what the feed returns.
