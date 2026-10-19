import type {
  IChatUser,
  IProfileResponse,
  ISearchProfilesQuery,
} from '@repo/contracts';

import { coreApi } from './client';

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
