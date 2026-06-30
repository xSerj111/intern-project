import { Inject, Injectable } from '@nestjs/common';
import { LoggerKey, type Logger, UpdateProfileDto } from '@repo/shared';
import { UserProfile } from './domain/entities/user-profile.entity';
import { UserProfileRepository } from './infrastructure/repository/user-profile.repository';

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly userProfileRepository: UserProfileRepository,
  ) {}

  // Temporary: Used for testing until Event-Driven architecture is wired up
  async createProfile(
    authUserId: string,
    handle: string,
  ): Promise<UserProfile> {
    // Construction rules live in the entity factory (displayName defaulting, etc.)
    const profile = UserProfile.create({ authUserId, username: handle });
    const savedProfile = await this.userProfileRepository.save(profile);
    this.logger.debug('Profile created', { props: { profileId: savedProfile.id } });
    return savedProfile;
  }

  async getProfile(id: string): Promise<UserProfile> {
    // Throws EntityByIdNotFoundError -> mapped to HTTP 404 by DomainExceptionFilter.
    const profile = await this.userProfileRepository.findOneByIdOrThrow(id);
    this.logger.debug('Profile retrieved', { props: { profileId: profile.id } });
    return profile;
  }

  async updateProfile(
    id: string,
    updateDto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const profile = await this.getProfile(id);
    // Mutations go through entity methods so the domain rules (length, etc.) hold.
    if (updateDto.bio !== undefined) {
      profile.editBio(updateDto.bio ?? null);
    }
    const updatedProfile = await this.userProfileRepository.save(profile);
    this.logger.debug('Profile updated', { props: { profileId: updatedProfile.id } });
    return updatedProfile;
  }
}
