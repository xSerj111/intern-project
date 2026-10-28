import { Test, TestingModule } from '@nestjs/testing';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { fakeUserProfile } from '../profiles/__tests__/fakers/user-profile.faker';
import { ProfileSummaryController } from './profile-summary.controller';
import { ProfileSummaryService } from './profile-summary.service';

describe('ProfileSummaryController', () => {
  let controller: ProfileSummaryController;
  const service = { getSummary: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileSummaryController],
      providers: [{ provide: ProfileSummaryService, useValue: service }],
    })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ProfileSummaryController);
  });

  it('returns the profile fields plus the counters', async () => {
    const profile = fakeUserProfile({ bio: 'hi', avatarUrl: null });
    service.getSummary.mockResolvedValue({
      profile,
      stats: {
        followerCount: 2,
        followingCount: 3,
        postCount: 4,
        isFollowedByMe: true,
      },
    });

    const response = await controller.getByUser('viewer', profile.authUserId);

    expect(service.getSummary).toHaveBeenCalledWith(
      profile.authUserId,
      'viewer',
    );
    expect(response).toMatchObject({
      id: profile.id,
      authUserId: profile.authUserId,
      username: 'john_doe',
      bio: 'hi',
      avatarUrl: null,
      followerCount: 2,
      followingCount: 3,
      postCount: 4,
      isFollowedByMe: true,
    });
  });

  it('uses a two-segment path that the one-segment :id route cannot match', () => {
    const names = Object.getOwnPropertyNames(
      ProfileSummaryController.prototype,
    );
    const path = Reflect.getMetadata(
      'path',
      Object.getOwnPropertyDescriptor(
        ProfileSummaryController.prototype,
        'getByUser',
      )?.value as object,
    ) as string;
    expect(names).toContain('getByUser');
    expect(path).toBe('by-user/:userId');
  });
});
