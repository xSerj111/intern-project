'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  ICreatePostRequest,
  IPostResponse,
  IUpdatePostRequest,
} from '@repo/contracts';

import {
  archivePost,
  createPost,
  deletePost,
  publishPost,
  updatePost,
} from '../api/posts';
import { useAuth } from '../auth/auth-context';
import { postKeys } from '../query/keys';

/** Returns a function that refreshes every cache a post change can affect. */
function useInvalidatePosts() {
  const queryClient = useQueryClient();

  return (id?: string, { removePost = false } = {}) => {
    // A deleted post must not be refetched (it would 404), so drop it instead.
    if (id && removePost) {
      queryClient.removeQueries({ queryKey: postKeys.post(id) });
    }
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: postKeys.feed }),
      queryClient.invalidateQueries({ queryKey: postKeys.search }),
    ];
    if (id && !removePost) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: postKeys.post(id) }),
      );
    }
    return Promise.all(invalidations);
  };
}

export function useCreatePost() {
  const { accessToken } = useAuth();
  const invalidate = useInvalidatePosts();

  return useMutation<IPostResponse, Error, ICreatePostRequest>({
    mutationFn: (body) => createPost(accessToken, body),
    onSuccess: (post) => invalidate(post.id),
  });
}

export function useUpdatePost(id: string) {
  const { accessToken } = useAuth();
  const invalidate = useInvalidatePosts();

  return useMutation<IPostResponse, Error, IUpdatePostRequest>({
    mutationFn: (body) => updatePost(accessToken, id, body),
    onSuccess: () => invalidate(id),
  });
}

export function usePublishPost(id: string) {
  const { accessToken } = useAuth();
  const invalidate = useInvalidatePosts();

  return useMutation<IPostResponse, Error, void>({
    mutationFn: () => publishPost(accessToken, id),
    onSuccess: () => invalidate(id),
  });
}

export function useArchivePost(id: string) {
  const { accessToken } = useAuth();
  const invalidate = useInvalidatePosts();

  return useMutation<IPostResponse, Error, void>({
    mutationFn: () => archivePost(accessToken, id),
    onSuccess: () => invalidate(id),
  });
}

export function useDeletePost(id: string) {
  const { accessToken } = useAuth();
  const invalidate = useInvalidatePosts();

  return useMutation<void, Error, void>({
    mutationFn: () => deletePost(accessToken, id),
    onSuccess: () => invalidate(id, { removePost: true }),
  });
}
