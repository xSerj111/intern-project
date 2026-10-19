import type {
  IChatUser,
  IProfileResponse,
  IProfileSummaryResponse,
  ISearchProfilesQuery,
  IUpdateProfileRequest,
} from '@repo/contracts';

import { coreApi } from './client';

/** TanStack Query key factories for profile data. */
export const profileKeys = {
  all: ['profiles'] as const,
  /** Keyed by auth user id so a different sign-in never sees a stale profile. */
  me: (userId: string | undefined) =>
    [...profileKeys.all, 'me', userId ?? 'anonymous'] as const,
  summary: (userId: string) => [...profileKeys.all, 'summary', userId] as const,
};

/**
 * Profile plus follower/following/post counts and follow state
 * (`GET /profiles/by-user/:userId`, auth user id).
 */
export function getProfileSummary(
  userId: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<IProfileSummaryResponse> {
  return coreApi<IProfileSummaryResponse>(`/profiles/by-user/${userId}`, {
    token,
    signal,
  });
}

/**
 * Update the caller's profile (`PATCH /profiles/:id`, profile id, owner only).
 * `avatarAssetId` must be an image the caller uploaded via `uploadAsset`.
 */
export function updateProfile(
  profileId: string,
  body: IUpdateProfileRequest,
  token?: string | null,
  signal?: AbortSignal,
): Promise<IProfileResponse> {
  return coreApi<IProfileResponse>(`/profiles/${profileId}`, {
    method: 'PATCH',
    token,
    signal,
    body,
  });
}

/**
 * Fetch the signed-in user's own profile (`GET /profiles/me`). The core service
 * resolves the profile from the JWT `sub`, so no id is needed on the client.
 */
export function getMyProfile(
  token: string | null,
  signal?: AbortSignal,
): Promise<IProfileResponse> {
  return coreApi<IProfileResponse>('/profiles/me', { token, signal });
}

/** Search users by username prefix (`GET /profiles/search`), no follow needed. */
export function searchProfiles(
  { q, limit }: ISearchProfilesQuery,
  token?: string | null,
  signal?: AbortSignal,
): Promise<IChatUser[]> {
  return coreApi<IChatUser[]>('/profiles/search', {
    token,
    signal,
    query: { q, limit },
  });
}

/**
 * Resolve users by auth user id in one request (`GET /profiles/by-users`).
 * Unknown ids are omitted by the server; an empty list skips the request.
 */
export function getUsersByIds(
  ids: string[],
  token?: string | null,
  signal?: AbortSignal,
): Promise<IChatUser[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return Promise.resolve([]);
  return coreApi<IChatUser[]>('/profiles/by-users', {
    token,
    signal,
    query: { ids: unique.join(',') },
  });
}
