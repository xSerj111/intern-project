import { UniqueConstraintViolationError } from '@repo/shared';
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
  const service = new ProfilesService(
    {} as never,
    repo as never,
    {} as never,
    {} as never,
  );

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
  const cache = { invalidateProfile: jest.fn() };
  const service = new ProfilesService(
    logger as never,
    repo as never,
    avatars,
    cache as never,
  );
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

  it('invalidates the cached profile by auth user id after a profile edit', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());

    await service.updateProfile('p-1', { displayName: 'New' }, OWNER);

    expect(cache.invalidateProfile).toHaveBeenCalledWith(OWNER);
    expect(cache.invalidateProfile.mock.invocationCallOrder[0]).toBeGreaterThan(
      repo.save.mock.invocationCallOrder[0],
    );
  });

  it('invalidates the cached profile after an avatar change', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());
    avatars.findAvatarSource.mockResolvedValue({
      id: 'asset-1',
      uploaderId: OWNER,
      url: 'https://cdn/a.png',
      mimeType: 'image/png',
    });

    await service.updateProfile('p-1', { avatarAssetId: 'asset-1' }, OWNER);

    expect(cache.invalidateProfile).toHaveBeenCalledWith(OWNER);
  });

  it('does not invalidate when the edit is rejected', async () => {
    repo.findOneByIdOrThrow.mockResolvedValue(profile());

    await expect(
      service.updateProfile('p-1', { bio: 'x' }, 'intruder'),
    ).rejects.toBeInstanceOf(NotProfileOwnerError);
    expect(cache.invalidateProfile).not.toHaveBeenCalled();
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

describe('ProfilesService profile creation cache invalidation', () => {
  const USER = '33333333-3333-3333-3333-333333333333';
  const repo = { findByAuthUserId: jest.fn(), save: jest.fn() };
  const cache = { invalidateProfile: jest.fn() };
  const service = new ProfilesService(
    { debug: jest.fn() } as never,
    repo as never,
    {} as never,
    cache as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    repo.findByAuthUserId.mockResolvedValue(null);
    repo.save.mockImplementation((p: unknown) => Promise.resolve(p));
  });

  it('invalidates the profile after createProfile (internal user-created path)', async () => {
    await service.createProfile(USER, 'amy');

    expect(cache.invalidateProfile).toHaveBeenCalledWith(USER);
    expect(cache.invalidateProfile.mock.invocationCallOrder[0]).toBeGreaterThan(
      repo.save.mock.invocationCallOrder[0],
    );
  });

  it('invalidates the profile after the lazy-init path creates it', async () => {
    await service.getOrCreateProfileByAuthUserId(USER, 'amy@example.com');

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(cache.invalidateProfile).toHaveBeenCalledWith(USER);
  });

  it('invalidates after a de-duplicated handle retry succeeds', async () => {
    repo.save
      .mockRejectedValueOnce(
        new UniqueConstraintViolationError('user_profiles', 'username taken'),
      )
      .mockImplementation((p: unknown) => Promise.resolve(p));

    await service.createProfile(USER, 'amy');

    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(cache.invalidateProfile).toHaveBeenCalledTimes(1);
    expect(cache.invalidateProfile).toHaveBeenCalledWith(USER);
  });

  it('does not invalidate when the profile already exists', async () => {
    repo.findByAuthUserId.mockResolvedValue(fakeUserProfile());

    await service.createProfile(USER, 'amy');

    expect(repo.save).not.toHaveBeenCalled();
    expect(cache.invalidateProfile).not.toHaveBeenCalled();
  });

  it('returns the winner row when a concurrent create loses on authUserId', async () => {
    const winner = fakeUserProfile();
    repo.findByAuthUserId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    repo.save.mockRejectedValueOnce(
      new UniqueConstraintViolationError(
        'user_profiles',
        'Key ("authUserId")=(x) already exists.',
      ),
    );

    await expect(
      service.getOrCreateProfileByAuthUserId(USER, 'amy@example.com'),
    ).resolves.toBe(winner);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('returns the winner row when the race is lost during the de-duplicated retry', async () => {
    const winner = fakeUserProfile();
    repo.findByAuthUserId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    repo.save
      .mockRejectedValueOnce(
        new UniqueConstraintViolationError('user_profiles', 'username taken'),
      )
      .mockRejectedValueOnce(
        new UniqueConstraintViolationError(
          'user_profiles',
          'Key ("authUserId")=(x) already exists.',
        ),
      );

    await expect(service.createProfile(USER, 'amy')).resolves.toBe(winner);
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('still rethrows a unique violation when no profile exists for the user', async () => {
    repo.save.mockRejectedValue(
      new UniqueConstraintViolationError('user_profiles', 'other'),
    );

    await expect(service.createProfile(USER, 'amy')).rejects.toBeInstanceOf(
      UniqueConstraintViolationError,
    );
  });
});
