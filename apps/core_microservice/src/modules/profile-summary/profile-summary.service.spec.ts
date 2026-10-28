import { EntityNotFoundError } from '@repo/shared';
import { fakeUserProfile } from '../profiles/__tests__/fakers/user-profile.faker';
import { ProfileSummaryResponseDto } from './dto/profile-summary-response.dto';
import { ProfileSummaryService } from './profile-summary.service';

const TARGET = '11111111-1111-1111-1111-111111111111';
const VIEWER = '22222222-2222-2222-2222-222222222222';

describe('ProfileSummaryService', () => {
  const logger = { debug: jest.fn(), warn: jest.fn() };
  const profiles = { getProfileByAuthUserId: jest.fn() };
  const follows = { count: jest.fn(), exists: jest.fn() };
  const posts = { countPublishedByAuthor: jest.fn() };
  const cache = {
    getProfile: jest.fn(),
    setProfile: jest.fn(),
    getCounts: jest.fn(),
    setCounts: jest.fn(),
  };
  const service = new ProfileSummaryService(
    logger as never,
    profiles as never,
    follows as never,
    posts as never,
    cache as never,
  );
  const profile = fakeUserProfile({ authUserId: TARGET });

  beforeEach(() => {
    jest.resetAllMocks();
    profiles.getProfileByAuthUserId.mockResolvedValue(profile);
    follows.count.mockImplementation(
      (where: { followingId?: string; followerId?: string }) =>
        Promise.resolve(where.followingId ? 12 : 5),
    );
    posts.countPublishedByAuthor.mockResolvedValue(3);
    follows.exists.mockResolvedValue(true);
    cache.getProfile.mockResolvedValue(null);
    cache.getCounts.mockResolvedValue(null);
    cache.setProfile.mockResolvedValue(undefined);
    cache.setCounts.mockResolvedValue(undefined);
  });

  it('counts followers, following and published posts of the target user', async () => {
    const { profile: found, stats } = await service.getSummary(TARGET, VIEWER);

    expect(found).toBe(profile);
    expect(follows.count).toHaveBeenCalledWith({ followingId: TARGET });
    expect(follows.count).toHaveBeenCalledWith({ followerId: TARGET });
    expect(posts.countPublishedByAuthor).toHaveBeenCalledWith(TARGET);
    expect(stats).toEqual({
      followerCount: 12,
      followingCount: 5,
      postCount: 3,
      isFollowedByMe: true,
    });
  });

  it('checks the viewer-to-target follow edge', async () => {
    await service.getSummary(TARGET, VIEWER);

    expect(follows.exists).toHaveBeenCalledWith({
      followerId: VIEWER,
      followingId: TARGET,
    });
  });

  it('reports isFollowedByMe false when the viewer is not following', async () => {
    follows.exists.mockResolvedValue(false);

    const { stats } = await service.getSummary(TARGET, VIEWER);

    expect(stats.isFollowedByMe).toBe(false);
  });

  it('reports isFollowedByMe false for the own profile without a lookup', async () => {
    const { stats } = await service.getSummary(TARGET, TARGET);

    expect(stats.isFollowedByMe).toBe(false);
    expect(follows.exists).not.toHaveBeenCalled();
  });

  it('reports isFollowedByMe false for anonymous viewers without a lookup', async () => {
    const { stats } = await service.getSummary(TARGET, undefined);

    expect(stats.isFollowedByMe).toBe(false);
    expect(follows.exists).not.toHaveBeenCalled();
  });

  it('propagates not-found when the user has no profile', async () => {
    profiles.getProfileByAuthUserId.mockRejectedValue(
      new EntityNotFoundError('UserProfile', { authUserId: TARGET }),
    );

    await expect(service.getSummary(TARGET, VIEWER)).rejects.toBeInstanceOf(
      EntityNotFoundError,
    );
    expect(follows.count).not.toHaveBeenCalled();
  });

  describe('caching', () => {
    const cachedProfile = {
      id: profile.id,
      authUserId: TARGET,
      username: profile.username,
      displayName: profile.displayName,
      bio: null,
      avatarUrl: null,
      // JSON round trip: dates come back as strings
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
    const cachedCounts = { followerCount: 7, followingCount: 8, postCount: 9 };

    it('on a miss loads from the DB and sets both cache entries', async () => {
      await service.getSummary(TARGET, VIEWER);

      expect(cache.getProfile).toHaveBeenCalledWith(TARGET);
      expect(cache.getCounts).toHaveBeenCalledWith(TARGET);
      expect(profiles.getProfileByAuthUserId).toHaveBeenCalledTimes(1);
      expect(cache.setProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          id: profile.id,
          authUserId: TARGET,
          bio: null,
          avatarUrl: null,
          createdAt: profile.createdAt,
        }),
      );
      expect(cache.setCounts).toHaveBeenCalledWith(TARGET, {
        followerCount: 12,
        followingCount: 5,
        postCount: 3,
      });
    });

    it('on a hit issues no profile or count queries and writes nothing', async () => {
      cache.getProfile.mockResolvedValue(cachedProfile);
      cache.getCounts.mockResolvedValue(cachedCounts);

      const { profile: found, stats } = await service.getSummary(
        TARGET,
        VIEWER,
      );

      expect(profiles.getProfileByAuthUserId).not.toHaveBeenCalled();
      expect(follows.count).not.toHaveBeenCalled();
      expect(posts.countPublishedByAuthor).not.toHaveBeenCalled();
      expect(cache.setProfile).not.toHaveBeenCalled();
      expect(cache.setCounts).not.toHaveBeenCalled();
      expect(found.id).toBe(profile.id);
      expect(found.createdAt).toBeInstanceOf(Date);
      expect(found.createdAt.toISOString()).toBe(cachedProfile.createdAt);
      expect(stats).toEqual({ ...cachedCounts, isFollowedByMe: true });
    });

    it('serializes a hit like a miss', async () => {
      const miss = await service.getSummary(TARGET, VIEWER);
      cache.getProfile.mockResolvedValue(cachedProfile);
      cache.getCounts.mockResolvedValue({
        followerCount: 12,
        followingCount: 5,
        postCount: 3,
      });
      const hit = await service.getSummary(TARGET, VIEWER);

      expect(
        JSON.stringify(new ProfileSummaryResponseDto(hit.profile, hit.stats)),
      ).toBe(
        JSON.stringify(new ProfileSummaryResponseDto(miss.profile, miss.stats)),
      );
    });

    it('computes isFollowedByMe per request even when everything is cached', async () => {
      cache.getProfile.mockResolvedValue(cachedProfile);
      cache.getCounts.mockResolvedValue(cachedCounts);

      follows.exists.mockResolvedValue(true);
      const first = await service.getSummary(TARGET, VIEWER);
      follows.exists.mockResolvedValue(false);
      const second = await service.getSummary(TARGET, VIEWER);
      const anonymous = await service.getSummary(TARGET, undefined);

      expect(first.stats.isFollowedByMe).toBe(true);
      expect(second.stats.isFollowedByMe).toBe(false);
      expect(anonymous.stats.isFollowedByMe).toBe(false);
      expect(follows.exists).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(cache.setCounts.mock.calls)).not.toContain(
        'isFollowedByMe',
      );
    });

    it('mixes a cached profile with DB counts (and the reverse)', async () => {
      cache.getProfile.mockResolvedValue(cachedProfile);
      await service.getSummary(TARGET, VIEWER);
      expect(profiles.getProfileByAuthUserId).not.toHaveBeenCalled();
      expect(cache.setProfile).not.toHaveBeenCalled();
      expect(cache.setCounts).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      cache.getProfile.mockResolvedValue(null);
      cache.getCounts.mockResolvedValue(cachedCounts);
      await service.getSummary(TARGET, VIEWER);
      expect(follows.count).not.toHaveBeenCalled();
      expect(cache.setProfile).toHaveBeenCalledTimes(1);
      expect(cache.setCounts).not.toHaveBeenCalled();
    });

    it('falls back to the DB when the cache rejects', async () => {
      const boom = new Error('redis down');
      cache.getProfile.mockRejectedValue(boom);
      cache.getCounts.mockRejectedValue(boom);
      cache.setProfile.mockRejectedValue(boom);
      cache.setCounts.mockRejectedValue(boom);

      const { profile: found, stats } = await service.getSummary(
        TARGET,
        VIEWER,
      );

      expect(found).toBe(profile);
      expect(stats).toEqual({
        followerCount: 12,
        followingCount: 5,
        postCount: 3,
        isFollowedByMe: true,
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('logs the stringified reason when the cache rejects with a non-Error', async () => {
      cache.getCounts.mockRejectedValue('redis gone');

      await service.getSummary(TARGET, VIEWER);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('read counts'),
        { props: { authUserId: TARGET, error: 'redis gone' } },
      );
    });

    it('serves a profile with null bio and avatar from the DB and caches nulls', async () => {
      profiles.getProfileByAuthUserId.mockResolvedValue(
        fakeUserProfile({
          authUserId: TARGET,
          bio: undefined,
          avatarUrl: undefined,
        }),
      );

      await service.getSummary(TARGET, VIEWER);

      expect(cache.setProfile).toHaveBeenCalledWith(
        expect.objectContaining({ bio: null, avatarUrl: null }),
      );
    });

    it('treats a corrupt cached profile as a miss', async () => {
      cache.getProfile.mockResolvedValue({
        ...cachedProfile,
        createdAt: 'not-a-date',
      });

      const { profile: found } = await service.getSummary(TARGET, VIEWER);

      expect(found).toBe(profile);
    });

    it('does not cache a not-found profile', async () => {
      profiles.getProfileByAuthUserId.mockRejectedValue(
        new EntityNotFoundError('UserProfile', { authUserId: TARGET }),
      );

      await expect(service.getSummary(TARGET, VIEWER)).rejects.toBeInstanceOf(
        EntityNotFoundError,
      );
      expect(cache.setProfile).not.toHaveBeenCalled();
      expect(cache.setCounts).not.toHaveBeenCalled();
    });
  });
});
