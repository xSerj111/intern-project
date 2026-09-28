import type {
  ICreatePostRequest,
  IPostResponse,
  IUpdatePostRequest,
} from '@repo/contracts';

import { coreApi } from './client';

/** Create a post (draft or published) via `POST /posts`. */
export function createPost(
  token: string | null,
  body: ICreatePostRequest,
): Promise<IPostResponse> {
  return coreApi<IPostResponse>('/posts', { method: 'POST', token, body });
}

/** Read a single post via `GET /posts/:id` (public). */
export function getPost(
  id: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${id}`, { token, signal });
}

/** Edit an own post's text and/or media via `PATCH /posts/:id`. */
export function updatePost(
  token: string | null,
  id: string,
  body: IUpdatePostRequest,
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${id}`, {
    method: 'PATCH',
    token,
    body,
  });
}

/** Publish a draft via `POST /posts/:id/publish`. */
export function publishPost(
  token: string | null,
  id: string,
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${id}/publish`, {
    method: 'POST',
    token,
  });
}

/** Archive a published post via `POST /posts/:id/archive`. */
export function archivePost(
  token: string | null,
  id: string,
): Promise<IPostResponse> {
  return coreApi<IPostResponse>(`/posts/${id}/archive`, {
    method: 'POST',
    token,
  });
}

/** Soft-delete an own post via `DELETE /posts/:id`. */
export function deletePost(token: string | null, id: string): Promise<void> {
  return coreApi<void>(`/posts/${id}`, { method: 'DELETE', token });
}
