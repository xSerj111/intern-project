import { createHash } from 'crypto';
import { ATTACHMENT_URL_TTL_SECONDS } from '../../modules/chats/domain/interfaces/attachment-storage.port';
import type { CacheResource } from './cache-store.port';

const PREFIX = 'cache:v1';

export const PROFILE_TTL_SEC = 60;
export const COUNTS_TTL_SEC = 60;
/** Links are cached for at most half their validity (research §7). */
export const SIGNED_URL_TTL_SEC = Math.floor(ATTACHMENT_URL_TTL_SECONDS / 2);

export const profileKey = (authUserId: string): string =>
  `${PREFIX}:profile:${authUserId}`;

export const countsKey = (authUserId: string): string =>
  `${PREFIX}:counts:${authUserId}`;

export const signedUrlKey = (assetId: string, disposition: string): string =>
  `${PREFIX}:surl:${assetId}:${createHash('sha1').update(disposition).digest('hex').slice(0, 8)}`;

const RESOURCE_BY_SEGMENT: Record<string, CacheResource> = {
  profile: 'profile',
  counts: 'follow_counts',
  surl: 'signed_url',
};

/** Metric label for a key built by the helpers above; `unknown` otherwise. */
export function cacheResourceOf(key: string): CacheResource | 'unknown' {
  const segment = key.startsWith(`${PREFIX}:`)
    ? key.slice(PREFIX.length + 1).split(':', 1)[0]
    : '';
  return RESOURCE_BY_SEGMENT[segment] ?? 'unknown';
}
