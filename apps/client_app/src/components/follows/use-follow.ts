'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { followKeys, followUser, unfollowUser } from '../../lib/api/follows';
import { profileKeys } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';

/**
 * Optimistic follow state for `userId` (auth user id). `initialFollowing`
 * comes from the server (e.g. `IProfileSummaryResponse.isFollowedByMe`); the
 * local value flips immediately and reverts if the request fails.
 */
export function useFollow(userId: string, initialFollowing: boolean) {
  const { accessToken, user } = useAuth();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(initialFollowing);

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? followUser(userId, { token: accessToken }).then(() => undefined)
        : unfollowUser(userId, { token: accessToken }),
    onMutate: (next) => {
      const previous = following;
      setFollowing(next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context) setFollowing(context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: profileKeys.summary(userId),
      });
      if (user?.id) {
        void queryClient.invalidateQueries({
          queryKey: profileKeys.summary(user.id),
        });
      }
      void queryClient.invalidateQueries({ queryKey: followKeys.all });
    },
  });

  // Adopt fresh server state when no request is in flight. Deliberately keyed
  // on the server value only, not on `isPending`.
  useEffect(() => {
    if (!mutation.isPending) setFollowing(initialFollowing);
  }, [initialFollowing]);

  return {
    following,
    isPending: mutation.isPending,
    error: mutation.error,
    toggle: () => mutation.mutate(!following),
    /** False for the viewer's own profile and while signed out. */
    canFollow: Boolean(accessToken) && user?.id !== userId,
  };
}
