'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import type { IFeedItem, IPostResponse } from '@repo/contracts';

import { likePost, unlikePost } from '../api/likes';
import { repostPost, unrepostPost } from '../api/reposts';
import { useAuth } from '../auth/auth-context';
import { postKeys } from '../query/keys';

type Patch = (post: IPostResponse) => IPostResponse;

function patchItem(item: IFeedItem, id: string, patch: Patch): IFeedItem {
  if ('repostAuthor' in item) {
    return item.post?.id === id ? { ...item, post: patch(item.post) } : item;
  }
  return item.id === id ? patch(item) : item;
}

interface Paged {
  items: IFeedItem[];
}

/** Applies `patch` to the post wherever it is cached (feed, search, detail). */
function patchCachedPost(queryClient: QueryClient, id: string, patch: Patch) {
  queryClient.setQueriesData<{ pages: Paged[]; pageParams: unknown[] }>(
    { queryKey: postKeys.feed },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => patchItem(item, id, patch)),
        })),
      },
  );
  queryClient.setQueriesData<{ pages: Paged[]; pageParams: unknown[] }>(
    { queryKey: postKeys.search },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => patchItem(item, id, patch)),
        })),
      },
  );
  queryClient.setQueryData<IPostResponse>(
    postKeys.post(id),
    (post) => post && patch(post),
  );
}

/**
 * Optimistic like / repost toggles for a post. The change is applied to every
 * cached copy straight away and rolled back if the request fails.
 */
export function usePostInteractions(post: IPostResponse) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const id = post.id;

  // The API doesn't return whether the viewer reposted, so remember it for the session.
  const { data: reposted = false } = useQuery({
    queryKey: postKeys.reposted(id),
    queryFn: () => false,
    enabled: false,
    initialData: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function snapshotAndPatch(patch: Patch) {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: postKeys.feed }),
      queryClient.cancelQueries({ queryKey: postKeys.search }),
      queryClient.cancelQueries({ queryKey: postKeys.post(id) }),
    ]);
    const snapshot = [
      ...queryClient.getQueriesData({ queryKey: postKeys.feed }),
      ...queryClient.getQueriesData({ queryKey: postKeys.search }),
      ...queryClient.getQueriesData({ queryKey: postKeys.post(id) }),
    ];
    patchCachedPost(queryClient, id, patch);
    return snapshot;
  }

  function rollback(snapshot: ReturnType<QueryClient['getQueriesData']>) {
    for (const [key, data] of snapshot) {
      queryClient.setQueryData(key, data);
    }
  }

  function settle() {
    void queryClient.invalidateQueries({ queryKey: postKeys.feed });
    void queryClient.invalidateQueries({ queryKey: postKeys.search });
    void queryClient.invalidateQueries({ queryKey: postKeys.post(id) });
  }

  const like = useMutation({
    mutationFn: (liked: boolean) =>
      liked ? unlikePost(accessToken, id) : likePost(accessToken, id),
    onMutate: (liked) =>
      snapshotAndPatch((p) => ({
        ...p,
        likedByMe: !liked,
        likeCount: Math.max(0, p.likeCount + (liked ? -1 : 1)),
      })),
    onError: (_error, _liked, snapshot) => snapshot && rollback(snapshot),
    onSettled: settle,
  });

  const repost = useMutation({
    mutationFn: (wasReposted: boolean) =>
      wasReposted ? unrepostPost(accessToken, id) : repostPost(accessToken, id),
    onMutate: async (wasReposted) => {
      const snapshot = await snapshotAndPatch((p) => ({
        ...p,
        repostCount: Math.max(0, p.repostCount + (wasReposted ? -1 : 1)),
      }));
      queryClient.setQueryData(postKeys.reposted(id), !wasReposted);
      return snapshot;
    },
    onError: (_error, wasReposted, snapshot) => {
      if (snapshot) rollback(snapshot);
      queryClient.setQueryData(postKeys.reposted(id), wasReposted);
    },
    onSettled: settle,
  });

  return {
    reposted,
    toggleLike: () => like.mutate(post.likedByMe),
    toggleRepost: () => repost.mutate(reposted),
    isLikePending: like.isPending,
    isRepostPending: repost.isPending,
  };
}
