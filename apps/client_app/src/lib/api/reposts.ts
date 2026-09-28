import { coreApi } from './client';

/** Idempotently re-post a published post (`POST /posts/:id/repost`). */
export function repostPost(token: string | null, id: string): Promise<void> {
  return coreApi<void>(`/posts/${id}/repost`, { method: 'POST', token });
}

/** Idempotently remove the viewer's re-post (`DELETE /posts/:id/repost`). */
export function unrepostPost(token: string | null, id: string): Promise<void> {
  return coreApi<void>(`/posts/${id}/repost`, { method: 'DELETE', token });
}
