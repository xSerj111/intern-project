import type {
  IFollowListItem,
  IFollowResponse,
  IOffsetPage,
} from '@repo/contracts';

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

interface PageOptions extends Auth {
  /** 1-based page number (default 1). */
  page?: number;
  /** Page size, 1..50 (server default 50). */
  limit?: number;
}

/** Who follows `userId` (`GET /follows/:userId/followers`), newest follow first. */
export function getFollowers(
  userId: string,
  { token, signal, page, limit }: PageOptions = {},
): Promise<IOffsetPage<IFollowListItem>> {
  return coreApi<IOffsetPage<IFollowListItem>>(`/follows/${userId}/followers`, {
    token,
    signal,
    query: { page, limit },
  });
}

/** Who `userId` follows (`GET /follows/:userId/following`), newest follow first. */
export function getFollowing(
  userId: string,
  { token, signal, page, limit }: PageOptions = {},
): Promise<IOffsetPage<IFollowListItem>> {
  return coreApi<IOffsetPage<IFollowListItem>>(`/follows/${userId}/following`, {
    token,
    signal,
    query: { page, limit },
  });
}
