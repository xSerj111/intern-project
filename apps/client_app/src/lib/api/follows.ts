import type { IFollowResponse } from '@repo/contracts';

import { coreApi } from './client';

/** TanStack Query key factories for follow data. */
export const followKeys = {
  all: ['follows'] as const,
  followers: (userId: string) =>
    [...followKeys.all, 'followers', userId] as const,
  following: (userId: string) =>
    [...followKeys.all, 'following', userId] as const,
};

interface Auth {
  token?: string | null;
  signal?: AbortSignal;
}

/** Follow a user (`POST /follows`); `userId` is the auth user id. */
export function followUser(
  userId: string,
  { token, signal }: Auth = {},
): Promise<IFollowResponse> {
  return coreApi<IFollowResponse>('/follows', {
    method: 'POST',
    token,
    signal,
    body: { followingId: userId },
  });
}

/** Unfollow a user (`DELETE /follows/:followingId`). */
export function unfollowUser(
  userId: string,
  { token, signal }: Auth = {},
): Promise<void> {
  return coreApi<void>(`/follows/${userId}`, {
    method: 'DELETE',
    token,
    signal,
  });
}

/** Who follows `userId` (`GET /follows/:userId/followers`). */
export function listFollowers(
  userId: string,
  { token, signal }: Auth = {},
): Promise<IFollowResponse[]> {
  return coreApi<IFollowResponse[]>(`/follows/${userId}/followers`, {
    token,
    signal,
  });
}

/** Who `userId` follows (`GET /follows/:userId/following`). */
export function listFollowing(
  userId: string,
  { token, signal }: Auth = {},
): Promise<IFollowResponse[]> {
  return coreApi<IFollowResponse[]>(`/follows/${userId}/following`, {
    token,
    signal,
  });
}
