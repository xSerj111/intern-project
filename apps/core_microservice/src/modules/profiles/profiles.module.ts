import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfile } from './domain/entities/user-profile.entity';
import { ProfileToProfileConfiguration } from './domain/entities/profile-to-profile-configuration.entity';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { UserProfileRepository } from './infrastructure/repository/user-profile.repository';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserProfile, ProfileToProfileConfiguration]),
    LoggerModule.forFeature('ProfilesService'),
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService, UserProfileRepository],
})
export class ProfilesModule {}
