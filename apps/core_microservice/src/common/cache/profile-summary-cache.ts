import { Inject, Injectable } from '@nestjs/common';
import {
  COUNTS_TTL_SEC,
  countsKey,
  PROFILE_TTL_SEC,
  profileKey,
} from './cache-keys';
import { CACHE_STORE, type ICacheStore } from './cache-store.port';

/** Public profile fields only; never viewer-specific data (data-model §4). */
export interface CachedProfile {
  id: string;
  authUserId: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  /** ISO strings, as serialized on the wire. */
  createdAt: string;
  updatedAt: string;
}

export interface CachedCounts {
  followerCount: number;
  followingCount: number;
  postCount: number;
}

type ProfileSource = Omit<
  CachedProfile,
  'bio' | 'avatarUrl' | 'createdAt' | 'updatedAt'
> & {
  bio?: string | null;
  avatarUrl?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const toIso = (d: Date | string): string =>
  d instanceof Date ? d.toISOString() : d;

/**
 * Typed cache-aside access for `GET /profiles/by-user/:userId`. Values are
 * whitelisted before writing, so extra fields on the source never leak in.
 */
@Injectable()
export class ProfileSummaryCache {
  constructor(@Inject(CACHE_STORE) private readonly store: ICacheStore) {}

  getProfile(authUserId: string): Promise<CachedProfile | null> {
    return this.store.get<CachedProfile>(profileKey(authUserId));
  }

  setProfile(profile: ProfileSource): Promise<void> {
    const value: CachedProfile = {
      id: profile.id,
      authUserId: profile.authUserId,
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      createdAt: toIso(profile.createdAt),
      updatedAt: toIso(profile.updatedAt),
    };
    return this.store.set(profileKey(value.authUserId), value, PROFILE_TTL_SEC);
  }

  getCounts(authUserId: string): Promise<CachedCounts | null> {
    return this.store.get<CachedCounts>(countsKey(authUserId));
  }

  setCounts(authUserId: string, counts: CachedCounts): Promise<void> {
    const value: CachedCounts = {
      followerCount: counts.followerCount,
      followingCount: counts.followingCount,
      postCount: counts.postCount,
    };
    return this.store.set(countsKey(authUserId), value, COUNTS_TTL_SEC);
  }

  invalidateProfile(authUserId: string): Promise<void> {
    return this.store.del(profileKey(authUserId));
  }

  invalidateCounts(...authUserIds: string[]): Promise<void> {
    return this.store.del(...authUserIds.map(countsKey));
  }
}
