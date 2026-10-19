import { ProfilesService } from './profiles.service';
import { fakeUserProfile } from './__tests__/fakers/user-profile.faker';
import {
  AvatarAssetNotFoundError,
  AvatarAssetNotOwnedError,
  InvalidAvatarAssetError,
  InvalidDisplayNameError,
  NotProfileOwnerError,
} from './domain/errors/user-profile.errors';

describe('ProfilesService.getUsersByIds', () => {
  const repo = { findByAuthUserIds: jest.fn() };
  const service = new ProfilesService({} as never, repo as never, {} as never);

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

describe('ProfilesService.updateProfile', () => {
  const OWNER = '11111111-1111-1111-1111-111111111111';
  const repo = { findOneByIdOrThrow: jest.fn(), save: jest.fn() };
  const avatars = { findAvatarSource: jest.fn() };
  const logger = { debug: jest.fn() };
  const service = new ProfilesService(logger as never, repo as never, avatars);
  const profile = () => fakeUserProfile({ authUserId: OWNER });

  beforeEach(() => {
    jest.resetAllMocks();
    repo.save.mockImplementation((p: unknown) => Promise.resolve(p));
  });

  it("forbids updating someone else's profile and saves nothing", async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());

    await expect(
      service.updateProfile('p-1', { bio: 'x' }, 'intruder'),
    ).rejects.toBeInstanceOf(NotProfileOwnerError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('renames, edits the bio and sets the avatar from a valid asset', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());
    avatars.findAvatarSource.mockResolvedValue({
      id: 'asset-1',
      uploaderId: OWNER,
      url: 'https://cdn/a.png',
      mimeType: 'image/png',
    });

    const result = await service.updateProfile(
      'p-1',
      { displayName: 'New Name', bio: 'hi', avatarAssetId: 'asset-1' },
      OWNER,
    );

    expect(avatars.findAvatarSource).toHaveBeenCalledWith('asset-1');
    expect(result).toMatchObject({
      displayName: 'New Name',
      bio: 'hi',
      avatarUrl: 'https://cdn/a.png',
    });
  });

  it('clears the avatar and bio with null without touching assets', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(
      fakeUserProfile({ authUserId: OWNER, bio: 'old', avatarUrl: 'old' }),
    );

    const result = await service.updateProfile(
      'p-1',
      { bio: null, avatarAssetId: null },
      OWNER,
    );

    expect(avatars.findAvatarSource).not.toHaveBeenCalled();
    expect(result.bio).toBeNull();
    expect(result.avatarUrl).toBeNull();
  });

  it('leaves untouched fields alone', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(
      fakeUserProfile({ authUserId: OWNER, bio: 'keep', avatarUrl: 'keep' }),
    );

    const result = await service.updateProfile('p-1', {}, OWNER);

    expect(result).toMatchObject({ bio: 'keep', avatarUrl: 'keep' });
  });

  it('rejects an unknown avatar asset and saves nothing', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());
    avatars.findAvatarSource.mockResolvedValue(null);

    await expect(
      service.updateProfile(
        'p-1',
        { displayName: 'Changed', avatarAssetId: 'missing' },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(AvatarAssetNotFoundError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects an avatar asset uploaded by another user', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());
    avatars.findAvatarSource.mockResolvedValue({
      id: 'asset-1',
      uploaderId: 'someone-else',
      url: 'https://cdn/a.png',
      mimeType: 'image/png',
    });

    await expect(
      service.updateProfile('p-1', { avatarAssetId: 'asset-1' }, OWNER),
    ).rejects.toBeInstanceOf(AvatarAssetNotOwnedError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a private or non-image avatar asset', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());
    avatars.findAvatarSource.mockResolvedValueOnce({
      id: 'a',
      uploaderId: OWNER,
      url: null,
      mimeType: 'image/png',
    });
    await expect(
      service.updateProfile('p-1', { avatarAssetId: 'a' }, OWNER),
    ).rejects.toBeInstanceOf(InvalidAvatarAssetError);

    avatars.findAvatarSource.mockResolvedValueOnce({
      id: 'b',
      uploaderId: OWNER,
      url: 'https://cdn/b.pdf',
      mimeType: 'application/pdf',
    });
    await expect(
      service.updateProfile('p-1', { avatarAssetId: 'b' }, OWNER),
    ).rejects.toBeInstanceOf(InvalidAvatarAssetError);
  });

  it('rejects a too-long display name through the entity', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());

    await expect(
      service.updateProfile('p-1', { displayName: 'a'.repeat(101) }, OWNER),
    ).rejects.toBeInstanceOf(InvalidDisplayNameError);
  });
});
