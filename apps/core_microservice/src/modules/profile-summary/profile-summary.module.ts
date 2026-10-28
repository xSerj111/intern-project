import { Module } from '@nestjs/common';
import { LoggerModule } from '@repo/shared';
import { FollowsModule } from '../follows/follows.module';
import { PostsModule } from '../posts/posts.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ProfileSummaryController } from './profile-summary.controller';
import { ProfileSummaryService } from './profile-summary.service';

@Module({
  imports: [
    LoggerModule.forFeature('ProfileSummaryService'),
    ProfilesModule,
    FollowsModule, // FollowRepositoryKey
    PostsModule, // POST_REPOSITORY
  ],
  controllers: [ProfileSummaryController],
  providers: [ProfileSummaryService],
})
export class ProfileSummaryModule {}
