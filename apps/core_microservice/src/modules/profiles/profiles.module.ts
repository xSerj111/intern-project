import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfile } from './domain/entities/user-profile.entity';
import { ProfileToProfileConfiguration } from './domain/entities/profile-to-profile-configuration.entity';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { UserProfileRepository } from './infrastructure/repository/user-profile.repository';
import { UserDirectoryAdapter } from './infrastructure/user-directory.adapter';
import { USER_DIRECTORY_PORT } from './domain/interfaces/user-directory.port';
import { UserProfileRepositoryKey } from './domain/interfaces/user-profile-repository.port';
import { AVATAR_ASSET_PORT } from './domain/interfaces/avatar-asset.port';
import { AvatarAssetAdapter } from './infrastructure/avatar-asset.adapter';
import { AssetsModule } from '../assets/assets.module';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserProfile, ProfileToProfileConfiguration]),
    LoggerModule.forFeature('ProfilesService'),
    AssetsModule, // AvatarAssetAdapter resolves avatar candidates
  ],
  controllers: [ProfilesController],
  providers: [
    ProfilesService,
    UserProfileRepository,
    { provide: UserProfileRepositoryKey, useExisting: UserProfileRepository },
    { provide: USER_DIRECTORY_PORT, useClass: UserDirectoryAdapter },
    { provide: AVATAR_ASSET_PORT, useClass: AvatarAssetAdapter },
  ],
  exports: [ProfilesService, USER_DIRECTORY_PORT],
})
export class ProfilesModule {}
