import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserProfile } from 'src/entities/user-profile.entity';
import { Repository } from 'typeorm';
import { UpdateProfileDto } from '@repo/shared';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly profilesRepository: Repository<UserProfile>,
  ) {}

  // Temporary: Used for testing until Event-Driven architecture is wired up
  async createProfile(authUserId: string, handle: string): Promise<UserProfile> {

    const profile = this.profilesRepository.create({ 
      authUserId: authUserId,
      username: handle,
      displayName: handle, // Defaulting displayName to their handle on creatin
    });
    return this.profilesRepository.save(profile);
  }

  async getProfile(id: string): Promise<UserProfile> {
    const profile = await this.profilesRepository.findOne({ where: { id } });
    if (!profile) {
      throw new NotFoundException(`Profile with ID ${id} not found`);
    }
    return profile;
  }

  async updateProfile(id: string, updateDto: UpdateProfileDto): Promise<UserProfile> {
    const profile = await this.getProfile(id);
    Object.assign(profile, updateDto) // Merges the new bio into the existing profile
    return this.profilesRepository.save(profile);
  }

}
