import { ProfilesService } from './profiles.service';

describe('ProfilesService.getUsersByIds', () => {
  const repo = { findByAuthUserIds: jest.fn() };
  const service = new ProfilesService({} as never, repo as never);

  beforeEach(() => jest.resetAllMocks());

  it('maps found profiles to chat users with a single IN query', async () => {
    repo.findByAuthUserIds.mockResolvedValue([
      { authUserId: 'u1', username: 'al', displayName: 'Al', avatarUrl: null },
      { authUserId: 'u2', username: 'bo', displayName: 'Bo', avatarUrl: 'x' },
    ]);

    const result = await service.getUsersByIds(['u1', 'u2', 'u1', 'missing']);

    expect(repo.findByAuthUserIds).toHaveBeenCalledTimes(1);
    expect(repo.findByAuthUserIds).toHaveBeenCalledWith([
      'u1',
      'u2',
      'missing',
    ]);
    expect(result).toEqual([
      { userId: 'u1', username: 'al', displayName: 'Al', avatarUrl: null },
      { userId: 'u2', username: 'bo', displayName: 'Bo', avatarUrl: 'x' },
    ]);
  });
});
