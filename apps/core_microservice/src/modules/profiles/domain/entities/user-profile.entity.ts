import { Column, Entity, Index } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import type { UserProfileProps } from '../../domain/interfaces/user-profile.props';
import {
  InvalidDisplayNameError,
  InvalidProfileBioError,
} from '../../domain/errors/user-profile.errors';

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

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl?: string;

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
    this.bio = bio ?? undefined;
  }

  /** Set or clear (with `null`) the avatar image URL. */
  setAvatar(avatarUrl: string | null): void {
    this.avatarUrl = avatarUrl ?? undefined;
  }

  get hasAvatar(): boolean {
    return Boolean(this.avatarUrl);
  }

  /** A profile is "complete" once it has a display name, a bio and an avatar. */
  get isComplete(): boolean {
    return Boolean(this.displayName) && Boolean(this.bio) && this.hasAvatar;
  }
}
