import type {
  ICommentResponse,
  ICreateCommentRequest,
  IUpdateCommentRequest,
} from '@repo/contracts';

import { coreApi } from './client';

/** List a post's comments, newest first (`GET /comments/post/:postId`). */
export function getCommentsByPost(
  postId: string,
  signal?: AbortSignal,
): Promise<ICommentResponse[]> {
  return coreApi<ICommentResponse[]>(`/comments/post/${postId}`, { signal });
}

/** Create a comment or reply (`POST /comments`). */
export function createComment(
  token: string | null,
  body: ICreateCommentRequest,
): Promise<ICommentResponse> {
  return coreApi<ICommentResponse>('/comments', {
    method: 'POST',
    token,
    body,
  });
}

/** Edit an own comment (`PATCH /comments/:id`). */
export function updateComment(
  token: string | null,
  id: string,
  body: IUpdateCommentRequest,
): Promise<ICommentResponse> {
  return coreApi<ICommentResponse>(`/comments/${id}`, {
    method: 'PATCH',
    token,
    body,
  });
}

/** Soft-delete an own comment (`DELETE /comments/:id`). */
export function deleteComment(
  token: string | null,
  id: string,
): Promise<void> {
  return coreApi<void>(`/comments/${id}`, { method: 'DELETE', token });
}
