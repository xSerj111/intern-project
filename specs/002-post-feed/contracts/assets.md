# Assets Contract

**Endpoint**: `POST /assets/upload` (core_microservice, port 3001)

Multipart upload of an image or video to attach to a post. Auth: `Authorization: Bearer <jwt>`.

## Request

`multipart/form-data` with a single `file` part.

- Max size: **10 MB**.
- Allowed MIME types (added by this feature): `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `video/mp4`, `video/webm`, `video/quicktime`.
- Unsupported type or oversized file → HTTP 400 with a friendly message (FR-006).

## Response (201)

```ts
export interface IAssetResponse {
  id: string;
  url: string;      // public S3/MinIO URL
  mimeType: string;
  size: number;
  createdAt: string;
}
```

## Client notes

- The client uploads each file first (`POST /assets/upload`), collects the returned asset `id`s, then submits them as `assetIds` to `POST /posts` / `PATCH /posts/:id`.
- The upload UI reports progress and errors (FR-005).
