'use client';

import { useQueries, useQuery } from '@tanstack/react-query';

import type { IChatUser } from '@repo/contracts';

import { getMyProfile, profileKeys, searchProfiles } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';

const MAX_LOOKUPS = 10;
const STALE_MS = 5 * 60_000;

/**
 * Resolve `@username` handles to profiles (lowercase username -> user). There
 * is no exact-lookup endpoint, so each handle goes through the prefix search
 * and keeps the exact match; unknown handles are absent and render as text.
 * The search leaves the caller out, so their own handle comes from `/profiles/me`.
 */
export function useMentionProfiles(usernames: string[]) {
  const { accessToken, user } = useAuth();
  const enabled = Boolean(accessToken) && usernames.length > 0;

  const me = useQuery({
    queryKey: profileKeys.me(user?.id),
    queryFn: ({ signal }) => getMyProfile(accessToken, signal),
    enabled,
    staleTime: STALE_MS,
  });
  const myUsername = me.data?.username.toLowerCase();

  const lookups = usernames
    .filter((name) => name !== myUsername)
    .slice(0, MAX_LOOKUPS);
  const results = useQueries({
    queries: lookups.map((name) => ({
      queryKey: ['mentions', 'resolve', name],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const found = await searchProfiles(
          { q: name, limit: 20 },
          accessToken,
          signal,
        );
        return found.find((u) => u.username.toLowerCase() === name) ?? null;
      },
      enabled: Boolean(accessToken),
      staleTime: STALE_MS,
    })),
  });

  const resolved = new Map<string, Pick<IChatUser, 'userId' | 'username'>>();
  results.forEach((result, index) => {
    if (result.data) resolved.set(lookups[index], result.data);
  });
  if (me.data && myUsername && usernames.includes(myUsername)) {
    resolved.set(myUsername, {
      userId: me.data.authUserId,
      username: me.data.username,
    });
  }
  return resolved;
}
