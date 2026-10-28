import { Column, Entity, Index } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import type { UserProfileProps } from '../../domain/interfaces/user-profile.props';
import {
  AvatarAssetNotOwnedError,
  InvalidAvatarAssetError,
  InvalidDisplayNameError,
  InvalidProfileBioError,
  NotProfileOwnerError,
} from '../../domain/errors/user-profile.errors';
import type { AvatarSource } from '../../domain/interfaces/avatar-asset.port';

export const DISPLAY_NAME_MAX_LENGTH = 100;
export const PROFILE_BIO_MAX_LENGTH = 160;

export interface CreateUserProfileProps {
  authUserId: string;
  username: string;
  displayName?: string;
}

@Entity('user_profiles')
export class UserProfile extends TypeormEntityBase implements UserProfileProps {
  @Index()
  @Column({ type: 'uuid', unique: true })
  authUserId!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  username!: string;

  @Column({ type: 'varchar', length: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string;

  // `null` (not `undefined`) clears a value: TypeORM skips undefined on save.
  @Column({ type: 'text', nullable: true })
  bio?: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl?: string | null;

  /**
   * Factory for creating a profile. Centralizes the construction rules
   * (e.g. defaulting the display name to the handle on first creation) so
   * callers can't build an inconsistent entity.
   */
  static create(props: CreateUserProfileProps): UserProfile {
    const profile = new UserProfile();
    profile.authUserId = props.authUserId;
    profile.username = props.username;
    profile.displayName = props.displayName?.trim() || props.username;
    return profile;
  }

  /** Rename the publicly displayed name, enforcing the domain length rule. */
  rename(displayName: string): void {
    const next = displayName.trim();
    if (next.length === 0 || next.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new InvalidDisplayNameError(displayName);
    }
    this.displayName = next;
  }

  /** Update (or clear, with `null`) the bio, enforcing the domain length rule. */
  editBio(bio: string | null): void {
    if (bio !== null && bio.length > PROFILE_BIO_MAX_LENGTH) {
      throw new InvalidProfileBioError(bio.length);
    }
    this.bio = bio;
  }

  /** Set or clear (with `null`) the avatar image URL. */
  setAvatar(avatarUrl: string | null): void {
    this.avatarUrl = avatarUrl;
  }

  /**
   * Use an uploaded asset as the avatar. It must be public, an image and
   * uploaded by this profile's owner.
   * @throws InvalidAvatarAssetError (400) when private or not an image
   * @throws AvatarAssetNotOwnedError (403) when someone else uploaded it
   */
  changeAvatar(asset: AvatarSource): void {
    if (asset.uploaderId !== this.authUserId) {
      throw new AvatarAssetNotOwnedError();
    }
    if (!asset.url) {
      throw new InvalidAvatarAssetError('it is not publicly accessible');
    }
    const mime = asset.mimeType.toLowerCase();
    // SVG is excluded: it can carry scripts if ever opened outside an <img>.
    if (!mime.startsWith('image/') || mime.startsWith('image/svg')) {
      throw new InvalidAvatarAssetError(
        `"${asset.mimeType}" is not an image type`,
      );
    }
    this.avatarUrl = asset.url;
  }

  /** @throws NotProfileOwnerError (403) unless `authUserId` owns this profile */
  assertOwnedBy(authUserId: string): void {
    if (this.authUserId !== authUserId) {
      throw new NotProfileOwnerError();
    }
  }

  get hasAvatar(): boolean {
    return Boolean(this.avatarUrl);
  }

  /** A profile is "complete" once it has a display name, a bio and an avatar. */
  get isComplete(): boolean {
    return Boolean(this.displayName) && Boolean(this.bio) && this.hasAvatar;
  }
}
