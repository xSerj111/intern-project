import { UserNotFoundError } from '../domain/errors/user-profile.errors';
import { fakeUserProfile } from '../__tests__/fakers/user-profile.faker';
import { UserDirectoryAdapter } from './user-directory.adapter';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('UserDirectoryAdapter', () => {
  const repo = { findByAuthUserIds: jest.fn() };
  const adapter = new UserDirectoryAdapter(repo as never);

  beforeEach(() => {
    jest.resetAllMocks();
    repo.findByAuthUserIds.mockResolvedValue([]);
  });

  describe('getUsers', () => {
    it('maps profiles to chat user snapshots keyed by auth user id', async () => {
      repo.findByAuthUserIds.mockResolvedValue([
        fakeUserProfile({
          authUserId: A,
          username: 'amy',
          displayName: 'Amy',
          avatarUrl: 'https://cdn/amy.png',
        }),
      ]);

      const users = await adapter.getUsers([A]);

      expect(users.get(A)).toEqual({
        userId: A,
        username: 'amy',
        displayName: 'Amy',
        avatarUrl: 'https://cdn/amy.png',
      });
    });

    it('returns a null avatar when the profile has none', async () => {
      repo.findByAuthUserIds.mockResolvedValue([
        fakeUserProfile({ authUserId: A, avatarUrl: undefined }),
      ]);

      const users = await adapter.getUsers([A]);

      expect(users.get(A)?.avatarUrl).toBeNull();
    });

    it('de-duplicates ids before the single repository lookup', async () => {
      await adapter.getUsers([A, B, A]);

      expect(repo.findByAuthUserIds).toHaveBeenCalledTimes(1);
      expect(repo.findByAuthUserIds).toHaveBeenCalledWith([A, B]);
    });

    it('omits ids without a profile', async () => {
      repo.findByAuthUserIds.mockResolvedValue([
        fakeUserProfile({ authUserId: A }),
      ]);

      const users = await adapter.getUsers([A, B]);

      expect([...users.keys()]).toEqual([A]);
    });
  });

  describe('assertUsersExist', () => {
    it('resolves when every id has a profile', async () => {
      repo.findByAuthUserIds.mockResolvedValue([
        fakeUserProfile({ authUserId: A }),
        fakeUserProfile({ authUserId: B }),
      ]);

      await expect(
        adapter.assertUsersExist([A, B, B]),
      ).resolves.toBeUndefined();
    });

    it('throws UserNotFoundError listing the missing ids', async () => {
      repo.findByAuthUserIds.mockResolvedValue([
        fakeUserProfile({ authUserId: A }),
      ]);

      const error: unknown = await adapter
        .assertUsersExist([A, B])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UserNotFoundError);
    });

    it('resolves for an empty id list', async () => {
      await expect(adapter.assertUsersExist([])).resolves.toBeUndefined();
    });
  });
});
