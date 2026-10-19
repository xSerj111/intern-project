import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { RedisModule } from './common/redis/redis.module';
import { CommonAuthModule } from './common/auth/common-auth.module';
import { MessagingModule } from './common/messaging/messaging.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { ProfileSummaryModule } from './modules/profile-summary/profile-summary.module';
import { PostsModule } from './modules/posts/posts.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ChatsModule } from './modules/chats/chats.module';
import { AssetsModule } from './modules/assets/assets.module';
import { FollowsModule } from './modules/follows/follows.module';
import { LikesModule } from './modules/likes/likes.module';
import { InternalEventsModule } from './modules/internal-events/internal-events.module';
import { NotificationsRelayModule } from './modules/notifications-relay/notifications-relay.module';

@Module({
  imports: [
    AppConfigModule,
    RedisModule,
    CommonAuthModule,

    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      // Entities are registered by each feature module via TypeOrmModule.forFeature();
      // autoLoadEntities pulls them in, so the root never lists entities itself.
      useFactory: (config: AppConfigService) => ({
        ...config.postgres,
        autoLoadEntities: true,
      }),
    }),
    MessagingModule,

    ProfilesModule,
    ProfileSummaryModule,
    PostsModule,
    CommentsModule,
    ChatsModule,
    AssetsModule,
    FollowsModule,
    LikesModule,
    InternalEventsModule,
    NotificationsRelayModule,
  ],
})
export class AppModule {}
