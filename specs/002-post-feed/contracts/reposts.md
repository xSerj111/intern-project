# Reposts Contract

**Endpoints** (core_microservice, port 3001): `POST /posts/:id/repost`, `DELETE /posts/:id/repost`

Both are JWT-guarded. A user may re-post a given post at most once (idempotent).

## `POST /posts/:id/repost`

- Auth: `Authorization: Bearer <jwt>`.
- Only a `published` post may be re-posted; otherwise HTTP 400.
- The re-post appears in the feed as an `IRepostResponse` with attribution to the original author (see [feed.md](./feed.md)).

## `DELETE /posts/:id/repost`

- Auth required; removes the caller's re-post (idempotent).

## Error responses

| Status | Condition |
|--------|-----------|
| 400 | Original post not published |
| 401 | Missing/invalid JWT |
| 404 | Post not found |

## Notes

- Re-posting is distinct from the client-side "share" actions (copy link / native share sheet), which require no backend.
- If the original post is later deleted, the re-post renders a "post unavailable" placeholder (`IRepostResponse.post === null`).
