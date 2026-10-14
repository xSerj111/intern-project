import type { ICommentResponse } from '@repo/contracts';

import { coreApi } from '../../lib/api/client';

/** TanStack Query key factory for a post's comments. */
export const commentKeys = {
  all: ['comments'] as const,
  post: (postId: string) => [...commentKeys.all, 'post', postId] as const,
};

/** List a post's comments (`GET /comments/post/:postId`, optional auth for `likedByMe`). */
export function getPostComments(
  postId: string,
  { token, signal }: { token?: string | null; signal?: AbortSignal } = {},
): Promise<ICommentResponse[]> {
  return coreApi<ICommentResponse[]>(`/comments/post/${postId}`, {
    token,
    signal,
  });
}

/** Create a top-level comment (`POST /comments`). */
export function createComment(
  body: { postId: string; content: string },
  { token }: { token?: string | null } = {},
): Promise<ICommentResponse> {
  return coreApi<ICommentResponse>('/comments', {
    method: 'POST',
    token,
    body,
  });
}
