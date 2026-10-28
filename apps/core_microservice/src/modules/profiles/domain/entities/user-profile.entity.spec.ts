import { fakeUserProfile } from '../../__tests__/fakers/user-profile.faker';
import {
  DISPLAY_NAME_MAX_LENGTH,
  PROFILE_BIO_MAX_LENGTH,
  UserProfile,
} from './user-profile.entity';
import {
  AvatarAssetNotOwnedError,
  InvalidAvatarAssetError,
  InvalidDisplayNameError,
  InvalidProfileBioError,
  NotProfileOwnerError,
} from '../../domain/errors/user-profile.errors';
import type { AvatarSource } from '../../domain/interfaces/avatar-asset.port';
import { AccessDeniedError } from '@repo/shared';

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

      // null (not undefined) so TypeORM actually writes NULL on save
      expect(profile.bio).toBeNull();
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

  describe('changeAvatar', () => {
    const OWNER = '11111111-1111-1111-1111-111111111111';
    const asset = (overrides: Partial<AvatarSource> = {}): AvatarSource => ({
      id: 'asset-1',
      uploaderId: OWNER,
      url: 'https://cdn/a.png',
      mimeType: 'image/png',
      ...overrides,
    });

    it('uses the url of a public image the owner uploaded', () => {
      const profile = fakeUserProfile({ authUserId: OWNER });

      profile.changeAvatar(asset());

      expect(profile.avatarUrl).toBe('https://cdn/a.png');
    });

    it('is case-insensitive about the mime type', () => {
      const profile = fakeUserProfile({ authUserId: OWNER });

      profile.changeAvatar(asset({ mimeType: 'IMAGE/JPEG' }));

      expect(profile.avatarUrl).toBe('https://cdn/a.png');
    });

    it('rejects an asset uploaded by someone else (403)', () => {
      const profile = fakeUserProfile({ authUserId: OWNER, avatarUrl: 'old' });

      const act = () => profile.changeAvatar(asset({ uploaderId: 'other' }));

      expect(act).toThrow(AvatarAssetNotOwnedError);
      expect(new AvatarAssetNotOwnedError()).toBeInstanceOf(AccessDeniedError);
      expect(profile.avatarUrl).toBe('old');
    });

    it('rejects a private asset (no public url)', () => {
      const profile = fakeUserProfile({ authUserId: OWNER });

      expect(() => profile.changeAvatar(asset({ url: null }))).toThrow(
        InvalidAvatarAssetError,
      );
    });

    it.each(['application/pdf', 'video/mp4', 'image/svg+xml'])(
      'rejects %s',
      (mimeType) => {
        const profile = fakeUserProfile({ authUserId: OWNER });

        expect(() => profile.changeAvatar(asset({ mimeType }))).toThrow(
          InvalidAvatarAssetError,
        );
        expect(profile.avatarUrl).toBeUndefined();
      },
    );
  });

  describe('setAvatar', () => {
    it('clears the avatar with null', () => {
      const profile = fakeUserProfile({ avatarUrl: 'https://cdn/x.png' });

      profile.setAvatar(null);

      expect(profile.avatarUrl).toBeNull();
      expect(profile.hasAvatar).toBe(false);
    });
  });

  describe('assertOwnedBy', () => {
    it('passes for the owner and throws NotProfileOwnerError otherwise', () => {
      const profile = fakeUserProfile({ authUserId: 'owner' });

      expect(() => profile.assertOwnedBy('owner')).not.toThrow();
      expect(() => profile.assertOwnedBy('intruder')).toThrow(
        NotProfileOwnerError,
      );
    });
  });
});
