import type { ICacheStore } from './cache-store.port';
import { ProfileSummaryCache } from './profile-summary-cache';

describe('ProfileSummaryCache', () => {
  const store = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let cache: ProfileSummaryCache;

  beforeEach(() => {
    jest.resetAllMocks();
    store.get.mockResolvedValue(null);
    store.set.mockResolvedValue(undefined);
    store.del.mockResolvedValue(undefined);
    cache = new ProfileSummaryCache(store as ICacheStore);
  });

  it('stores exactly the public profile fields with the profile TTL', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    await cache.setProfile({
      id: 'p1',
      authUserId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      bio: null,
      avatarUrl: 'https://x/a.png',
      createdAt,
      updatedAt: createdAt,
      isFollowedByMe: true,
    } as Parameters<ProfileSummaryCache['setProfile']>[0]);

    expect(store.set).toHaveBeenCalledWith(
      'cache:v1:profile:u1',
      {
        id: 'p1',
        authUserId: 'u1',
        username: 'alice',
        displayName: 'Alice',
        bio: null,
        avatarUrl: 'https://x/a.png',
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-01-02T03:04:05.000Z',
      },
      60,
    );
  });

  it('stores only the three counts with the counts TTL', async () => {
    await cache.setCounts('u1', {
      followerCount: 1,
      followingCount: 2,
      postCount: 3,
      isFollowedByMe: false,
    } as Parameters<ProfileSummaryCache['setCounts']>[1]);

    expect(store.set).toHaveBeenCalledWith(
      'cache:v1:counts:u1',
      { followerCount: 1, followingCount: 2, postCount: 3 },
      60,
    );
  });

  it('reads by user key', async () => {
    await cache.getProfile('u1');
    await cache.getCounts('u2');
    expect(store.get).toHaveBeenNthCalledWith(1, 'cache:v1:profile:u1');
    expect(store.get).toHaveBeenNthCalledWith(2, 'cache:v1:counts:u2');
  });

  it('invalidates the profile and the counts of every given user', async () => {
    await cache.invalidateProfile('u1');
    await cache.invalidateCounts('a', 'b');
    expect(store.del).toHaveBeenNthCalledWith(1, 'cache:v1:profile:u1');
    expect(store.del).toHaveBeenNthCalledWith(
      2,
      'cache:v1:counts:a',
      'cache:v1:counts:b',
    );
  });
});
