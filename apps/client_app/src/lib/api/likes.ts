import { coreApi } from './client';

/** Idempotently like a post (`POST /posts/:id/like`). */
export function likePost(token: string | null, id: string): Promise<void> {
  return coreApi<void>(`/posts/${id}/like`, { method: 'POST', token });
}

/** Idempotently remove a like (`DELETE /posts/:id/like`). */
export function unlikePost(token: string | null, id: string): Promise<void> {
  return coreApi<void>(`/posts/${id}/like`, { method: 'DELETE', token });
}
