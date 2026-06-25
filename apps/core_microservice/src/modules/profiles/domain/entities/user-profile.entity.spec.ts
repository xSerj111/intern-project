import { fakeUserProfile } from '../../__tests__/fakers/user-profile.faker';
import {
  DISPLAY_NAME_MAX_LENGTH,
  PROFILE_BIO_MAX_LENGTH,
  UserProfile,
} from './user-profile.entity';
import {
  InvalidDisplayNameError,
  InvalidProfileBioError,
} from '../../domain/errors/user-profile.errors';

describe('UserProfile', () => {
  describe('create', () => {
    it('defaults the display name to the handle when none is provided', () => {
      const profile = UserProfile.create({
        authUserId: 'auth-1',
        username: 'jane',
      });

      expect(profile.displayName).toBe('jane');
    });

    it('uses the provided display name when present', () => {
      const profile = UserProfile.create({
        authUserId: 'auth-1',
        username: 'jane',
        displayName: 'Jane Doe',
      });

      expect(profile.displayName).toBe('Jane Doe');
    });
  });

  describe('rename', () => {
    it('updates and trims the display name', () => {
      const profile = fakeUserProfile();

      profile.rename('  New Name  ');

      expect(profile.displayName).toBe('New Name');
    });

    it('throws InvalidDisplayNameError when empty', () => {
      const profile = fakeUserProfile();

      expect(() => profile.rename('   ')).toThrow(InvalidDisplayNameError);
    });

    it('throws InvalidDisplayNameError when too long', () => {
      const profile = fakeUserProfile();

      expect(() =>
        profile.rename('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)),
      ).toThrow(InvalidDisplayNameError);
    });
  });

  describe('editBio', () => {
    it('sets the bio', () => {
      const profile = fakeUserProfile();

      profile.editBio('hello world');

      expect(profile.bio).toBe('hello world');
    });

    it('clears the bio when given null', () => {
      const profile = fakeUserProfile({ bio: 'something' });

      profile.editBio(null);

      expect(profile.bio).toBeUndefined();
    });

    it('throws InvalidProfileBioError when over the limit', () => {
      const profile = fakeUserProfile();

      expect(() =>
        profile.editBio('a'.repeat(PROFILE_BIO_MAX_LENGTH + 1)),
      ).toThrow(InvalidProfileBioError);
    });
  });

  describe('hasAvatar / isComplete', () => {
    it('hasAvatar reflects avatar presence', () => {
      expect(fakeUserProfile({ avatarUrl: undefined }).hasAvatar).toBe(false);
      expect(
        fakeUserProfile({ avatarUrl: 'https://cdn/x.png' }).hasAvatar,
      ).toBe(true);
    });

    it('isComplete is true only with a display name, a bio and an avatar', () => {
      expect(fakeUserProfile({ bio: 'b', avatarUrl: 'u' }).isComplete).toBe(
        true,
      );
      expect(
        fakeUserProfile({ bio: undefined, avatarUrl: 'u' }).isComplete,
      ).toBe(false);
    });
  });
});
