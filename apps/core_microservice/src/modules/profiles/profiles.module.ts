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
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserProfile, ProfileToProfileConfiguration]),
    LoggerModule.forFeature('ProfilesService'),
  ],
  controllers: [ProfilesController],
  providers: [
    ProfilesService,
    UserProfileRepository,
    { provide: UserProfileRepositoryKey, useExisting: UserProfileRepository },
    { provide: USER_DIRECTORY_PORT, useClass: UserDirectoryAdapter },
  ],
  exports: [ProfilesService, USER_DIRECTORY_PORT],
})
export class ProfilesModule {}
