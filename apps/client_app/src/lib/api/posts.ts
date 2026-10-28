import type {
  ICreatePostRequest,
  IOffsetPage,
  IPostResponse,
  IPostsByAuthorQuery,
  IUpdatePostRequest,
} from '@repo/contracts';

import { coreApi } from './client';

/** TanStack Query key factories for post data. */
export const postKeys = {
  all: ['posts'] as const,
  feed: () => [...postKeys.all, 'feed'] as const,
  detail: (id: string) => [...postKeys.all, 'detail', id] as const,
  byAuthor: (userId: string, status?: IPostsByAuthorQuery['status']) =>
    [...postKeys.all, 'author', userId, status ?? 'published'] as const,
};

interface Auth {
  token?: string | null;
  signal?: AbortSignal;
}

/** Fetch one post (`GET /posts/:id`); drafts are visible to their author only. */
export function getPost(
  postId: string,
  { token, signal }: Auth = {},
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${postId}`, { token, signal });
}

/**
 * A user's posts, newest first (`GET /posts/author/:userId`). `userId` is the
 * auth user id. Statuses other than `published` are only allowed for the author.
 */
export function getPostsByAuthor(
  userId: string,
  { page = 1, limit = 12, status }: IPostsByAuthorQuery = {},
  { token, signal }: Auth = {},
): Promise<IOffsetPage<IPostResponse>> {
  return coreApi<IOffsetPage<IPostResponse>>(`/posts/author/${userId}`, {
    token,
    signal,
    query: { page, limit, status },
  });
}

/** Create a post (`POST /posts`). New posts start as drafts; call {@link publishPost}. */
export function createPost(
  body: ICreatePostRequest,
  { token, signal }: Auth = {},
): Promise<IPostResponse> {
  return coreApi<IPostResponse>('/posts', {
    method: 'POST',
    token,
    signal,
    body,
  });
}

/** Publish a draft (`POST /posts/:id/publish`) so it appears in feeds. */
export function publishPost(
  postId: string,
  { token, signal }: Auth = {},
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${postId}/publish`, {
    method: 'POST',
    token,
    signal,
  });
}

/** Edit a post's text (`PATCH /posts/:id`, author only). */
export function updatePost(
  postId: string,
  body: IUpdatePostRequest,
  { token, signal }: Auth = {},
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${postId}`, {
    method: 'PATCH',
    token,
    signal,
    body,
  });
}

/** Archive a post (`POST /posts/:id/archive`, author only). */
export function archivePost(
  postId: string,
  { token, signal }: Auth = {},
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${postId}/archive`, {
    method: 'POST',
    token,
    signal,
  });
}

/** Delete a post (`DELETE /posts/:id`, author only). */
export function deletePost(
  postId: string,
  { token, signal }: Auth = {},
): Promise<void> {
  return coreApi<void>(`/posts/${postId}`, {
    method: 'DELETE',
    token,
    signal,
  });
}
