import { randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EntityNotFoundError,
  LoggerKey,
  type Logger,
  UniqueConstraintViolationError,
  UpdateProfileDto,
} from '@repo/shared';
import type { IChatUser } from '@repo/contracts';
import { UserProfile } from './domain/entities/user-profile.entity';
import { UserProfileRepository } from './infrastructure/repository/user-profile.repository';
import {
  AVATAR_ASSET_PORT,
  type IAvatarAssetPort,
} from './domain/interfaces/avatar-asset.port';
import { AvatarAssetNotFoundError } from './domain/errors/user-profile.errors';

/** Max attempts to allocate a non-colliding username before giving up. */
const MAX_USERNAME_ATTEMPTS = 3;

const toChatUser = (p: UserProfile): IChatUser => ({
  userId: p.authUserId,
  username: p.username,
  displayName: p.displayName,
  avatarUrl: p.avatarUrl ?? null,
});

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly userProfileRepository: UserProfileRepository,
    @Inject(AVATAR_ASSET_PORT)
    private readonly avatarAssets: IAvatarAssetPort,
  ) {}

  // Temporary: Used for testing until Event-Driven architecture is wired up
  async createProfile(
    authUserId: string,
    handle: string,
  ): Promise<UserProfile> {
    // Idempotency: if a profile already exists for this auth user (a replayed
    // or retried `user.created` event), return it instead of failing on the
    // unique `authUserId` constraint.
    const existing =
      await this.userProfileRepository.findByAuthUserId(authUserId);
    if (existing) {
      return existing;
    }

    // Construction rules live in the entity factory (displayName defaulting, etc.)
    const profile = UserProfile.create({ authUserId, username: handle });

    try {
      const savedProfile = await this.userProfileRepository.save(profile);
      this.logger.debug('Profile created', {
        props: { profileId: savedProfile.id },
      });
      return savedProfile;
    } catch (error) {
      if (!this.isUsernameCollision(error)) {
        throw error;
      }

      // The username is taken (email local-part collisions are common). Fall
      // back to a de-duplicated handle with a short random suffix.
      for (let attempt = 1; attempt <= MAX_USERNAME_ATTEMPTS; attempt += 1) {
        const deduplicatedHandle = `${handle}-${randomBytes(3).toString('hex')}`;
        const retryProfile = UserProfile.create({
          authUserId,
          username: deduplicatedHandle,
        });

        try {
          const savedProfile =
            await this.userProfileRepository.save(retryProfile);
          this.logger.debug('Profile created with de-duplicated handle', {
            props: {
              profileId: savedProfile.id,
              username: savedProfile.username,
            },
          });
          return savedProfile;
        } catch (retryError) {
          if (!this.isUsernameCollision(retryError)) {
            throw retryError;
          }
        }
      }

      throw new UniqueConstraintViolationError(
        'user_profiles',
        'could not allocate a unique username',
      );
    }
  }

  async getProfile(id: string): Promise<UserProfile> {
    // Throws EntityByIdNotFoundError -> mapped to HTTP 404 by DomainExceptionFilter.
    const profile = await this.userProfileRepository.findOneByIdOrThrow(id);
    this.logger.debug('Profile retrieved', {
      props: { profileId: profile.id },
    });
    return profile;
  }

  /**
   * Resolve the profile belonging to the authenticated auth user
   * (`authUserId === JWT sub`). Used by `GET /profiles/me`.
   */
  async getProfileByAuthUserId(authUserId: string): Promise<UserProfile> {
    const profile =
      await this.userProfileRepository.findByAuthUserId(authUserId);
    if (!profile) {
      // -> HTTP 404 via DomainExceptionFilter (lazy-init may not have run yet).
      throw new EntityNotFoundError('UserProfile', { authUserId });
    }
    this.logger.debug('Profile retrieved by auth user id', {
      props: { authUserId, profileId: profile.id },
    });
    return profile;
  }

  /**
   * Resolve the profile for the authenticated user, lazily creating it on
   * first read when the `user.created` event was lost (fire-and-forget
   * publish) or failed (e.g. a username collision). This is the safety net for
   * the Auth -> Core event flow.
   */
  async getOrCreateProfileByAuthUserId(
    authUserId: string,
    email?: string,
  ): Promise<UserProfile> {
    const existing =
      await this.userProfileRepository.findByAuthUserId(authUserId);
    if (existing) {
      return existing;
    }

    this.logger.debug('Profile missing, lazily creating', {
      props: { authUserId },
    });
    return this.createProfile(authUserId, this.deriveHandle(email));
  }

  /**
   * Partial update of the caller's own profile. `avatarAssetId` is resolved
   * through the assets port (`null` clears the avatar); all rules live on the
   * entity, and nothing is persisted unless every field is valid.
   * @throws NotProfileOwnerError (403) when `callerAuthUserId` is not the owner
   * @throws AvatarAssetNotFoundError / InvalidAvatarAssetError (400),
   *         AvatarAssetNotOwnedError (403) for a bad avatar asset
   */
  async updateProfile(
    id: string,
    updateDto: UpdateProfileDto,
    callerAuthUserId: string,
  ): Promise<UserProfile> {
    const profile = await this.getProfile(id);
    profile.assertOwnedBy(callerAuthUserId);

    if (updateDto.displayName != null) {
      profile.rename(updateDto.displayName);
    }
    if (updateDto.bio !== undefined) {
      profile.editBio(updateDto.bio);
    }
    if (updateDto.avatarAssetId === null) {
      profile.setAvatar(null);
    } else if (updateDto.avatarAssetId !== undefined) {
      const asset = await this.avatarAssets.findAvatarSource(
        updateDto.avatarAssetId,
      );
      if (!asset) throw new AvatarAssetNotFoundError(updateDto.avatarAssetId);
      profile.changeAvatar(asset);
    }

    const updatedProfile = await this.userProfileRepository.save(profile);
    this.logger.debug('Profile updated', {
      props: { profileId: updatedProfile.id },
    });
    return updatedProfile;
  }

  private isUsernameCollision(error: unknown): boolean {
    return (
      error instanceof UniqueConstraintViolationError &&
      error.message.includes('username')
    );
  }

  private deriveHandle(email?: string): string {
    const localPart = email?.split('@')[0]?.trim();
    return localPart || 'user';
  }

  /** Username-prefix search for starting conversations; the caller is left out. */
  async searchProfiles(
    q: string,
    limit: number,
    callerAuthUserId: string,
  ): Promise<IChatUser[]> {
    const profiles = await this.userProfileRepository.searchByUsername(
      q,
      limit,
      callerAuthUserId,
    );
    return profiles.map(toChatUser);
  }

  /** Batch profile lookup by auth user id (one IN query); unknown ids are omitted. */
  async getUsersByIds(authUserIds: string[]): Promise<IChatUser[]> {
    const profiles = await this.userProfileRepository.findByAuthUserIds([
      ...new Set(authUserIds),
    ]);
    return profiles.map(toChatUser);
  }
}
