import type { ICommentResponse, IOffsetPage } from '@repo/contracts';

import { coreApi } from '../../lib/api/client';

/** TanStack Query key factory for a post's comments. */
export const commentKeys = {
  all: ['comments'] as const,
  post: (postId: string) => [...commentKeys.all, 'post', postId] as const,
};

/** Root comments per page (the server counts roots; replies ride along). */
export const COMMENTS_PAGE_SIZE = 20;

/**
 * One page of a post's comments (`GET /comments/post/:postId`, optional auth for
 * `likedByMe`): the page's roots newest-first, then all their replies.
 */
export function getPostComments(
  postId: string,
  {
    token,
    signal,
    page,
    limit = COMMENTS_PAGE_SIZE,
  }: {
    token?: string | null;
    signal?: AbortSignal;
    page?: number;
    limit?: number;
  } = {},
): Promise<IOffsetPage<ICommentResponse>> {
  return coreApi<IOffsetPage<ICommentResponse>>(`/comments/post/${postId}`, {
    token,
    signal,
    query: { page, limit },
  });
}

/** Concatenate fetched pages, dropping repeats (offset paging can overlap after inserts). */
export function mergeCommentPages(
  pages: IOffsetPage<ICommentResponse>[],
): ICommentResponse[] {
  const byId = new Map<string, ICommentResponse>();
  for (const page of pages) {
    for (const comment of page.items) {
      if (!byId.has(comment.id)) byId.set(comment.id, comment);
    }
  }
  return [...byId.values()];
}

/** Create a comment, or a reply when `parentId` is set (`POST /comments`). */
export function createComment(
  body: { postId: string; content: string; parentId?: string },
  { token }: { token?: string | null } = {},
): Promise<ICommentResponse> {
  return coreApi<ICommentResponse>('/comments', {
    method: 'POST',
    token,
    body,
  });
}

/** Delete one of the caller's own comments (`DELETE /comments/:id`, 204). */
export function deleteComment(
  commentId: string,
  { token }: { token?: string | null } = {},
): Promise<void> {
  return coreApi<void>(`/comments/${commentId}`, {
    method: 'DELETE',
    token,
  });
}

/** Edit the text of one of the caller's own comments (`PATCH /comments/:id`). */
export function updateComment(
  commentId: string,
  body: { content: string },
  { token }: { token?: string | null } = {},
): Promise<ICommentResponse> {
  return coreApi<ICommentResponse>(`/comments/${commentId}`, {
    method: 'PATCH',
    token,
    body,
  });
}
