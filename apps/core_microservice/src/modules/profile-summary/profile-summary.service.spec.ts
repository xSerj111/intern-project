import { EntityNotFoundError } from '@repo/shared';
import { fakeUserProfile } from '../profiles/__tests__/fakers/user-profile.faker';
import { ProfileSummaryService } from './profile-summary.service';

const TARGET = '11111111-1111-1111-1111-111111111111';
const VIEWER = '22222222-2222-2222-2222-222222222222';

describe('ProfileSummaryService', () => {
  const logger = { debug: jest.fn() };
  const profiles = { getProfileByAuthUserId: jest.fn() };
  const follows = { count: jest.fn(), exists: jest.fn() };
  const posts = { countPublishedByAuthor: jest.fn() };
  const service = new ProfileSummaryService(
    logger as never,
    profiles as never,
    follows as never,
    posts as never,
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
});
