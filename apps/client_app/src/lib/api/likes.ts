import type { ILikeState } from '@repo/contracts';

import { coreApi } from './client';

/** TanStack Query key factories for like state. */
export const likeKeys = {
  all: ['likes'] as const,
  post: (postId: string) => [...likeKeys.all, 'post', postId] as const,
  comment: (commentId: string) =>
    [...likeKeys.all, 'comment', commentId] as const,
};

interface Auth {
  token?: string | null;
  signal?: AbortSignal;
}

/** Like a post (`PUT /posts/:postId/like`, idempotent). */
export function likePost(
  postId: string,
  { token, signal }: Auth = {},
): Promise<ILikeState> {
  return coreApi<ILikeState>(`/posts/${postId}/like`, {
    method: 'PUT',
    token,
    signal,
  });
}

/** Remove the caller's like from a post (`DELETE /posts/:postId/like`). */
export function unlikePost(
  postId: string,
  { token, signal }: Auth = {},
): Promise<ILikeState> {
  return coreApi<ILikeState>(`/posts/${postId}/like`, {
    method: 'DELETE',
    token,
    signal,
  });
}

/** Like a comment (`PUT /comments/:commentId/like`, idempotent). */
export function likeComment(
  commentId: string,
  { token, signal }: Auth = {},
): Promise<ILikeState> {
  return coreApi<ILikeState>(`/comments/${commentId}/like`, {
    method: 'PUT',
    token,
    signal,
  });
}

/** Remove the caller's like from a comment (`DELETE /comments/:commentId/like`). */
export function unlikeComment(
  commentId: string,
  { token, signal }: Auth = {},
): Promise<ILikeState> {
  return coreApi<ILikeState>(`/comments/${commentId}/like`, {
    method: 'DELETE',
    token,
    signal,
  });
}
