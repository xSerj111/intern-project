# Search Contract

**Endpoint**: `GET /posts/search` (core_microservice, port 3001)

## Request

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `keyword` | string | *(required)* | `>= 3` chars (FR-022) |
| `page` | integer | 1 | `>= 1` |
| `limit` | integer | 20 | `>= 1` |

Public (no auth). A keyword shorter than 3 chars → HTTP 400.

## Response (200)

```ts
export interface ISearchResponse {
  items: IPostResponse[];  // matching published posts
  total: number;
  page: number;
  limit: number;
}
```

## Client notes

- Empty result set renders a friendly "no results" state (FR-021).
- Very large result sets paginate and load progressively.
