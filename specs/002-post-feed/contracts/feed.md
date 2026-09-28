# Feed Contract

**Endpoint**: `GET /posts/feed` (core_microservice, port 3001)

## Request

Query parameters (extending `FeedQueryDto`):

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `feed` | `following` \| `discover` | `following` | `following` = followed + own; `discover` = all public |
| `sort` | `newest` \| `oldest` \| `most_liked` | `newest` | |
| `mediaType` | `photos` \| `videos` \| `text` | *(none)* | optional; absent = no filter |
| `page` | integer | 1 | `>= 1` |
| `limit` | integer | 20 | `>= 1` |

Auth: `Authorization: Bearer <jwt>` (required — `likedByMe` and the `following` set need the viewer).

## Response (200)

```ts
// posts/responses.ts
export type FeedType = 'following' | 'discover';
export type PostSort = 'newest' | 'oldest' | 'most_liked';
export type MediaTypeFilter = 'photos' | 'videos' | 'text';

export interface IRepostResponse {
  id: string;                       // repost id
  repostAuthor: IAuthorSummary;     // who re-posted
  post: IPostResponse | null;       // null when the original is unavailable (deleted)
  createdAt: string;
}

export type IFeedItem = IPostResponse | IRepostResponse;
// discriminate: a repost item has `repostAuthor`.

export interface IFeedResponse {
  items: IFeedItem[];   // note: `items`, not `data`
  total: number;
  page: number;
  limit: number;
}
```

## Semantics

- Only `published` posts appear (drafts/archived/deleted are excluded).
- `most_liked` sorts by descending like count.
- `mediaType=photos` → posts with ≥1 image asset; `videos` → ≥1 video asset; `text` → no assets.
- Re-post items carry the original post (with the original author) plus `repostAuthor`; a deleted original renders as `post: null` ("post unavailable" placeholder).

## Client notes

- The client reads `items` (not `data`).
- Following/Discover are toggled by changing `feed`; sort/filter by changing `sort`/`mediaType` (FR-017/018/019/023).
