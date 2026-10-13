import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { RedisModule } from './common/redis/redis.module';
import { CommonAuthModule } from './common/auth/common-auth.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { PostsModule } from './modules/posts/posts.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ChatsModule } from './modules/chats/chats.module';
import { AssetsModule } from './modules/assets/assets.module';
import { FollowsModule } from './modules/follows/follows.module';
import { InternalEventsModule } from './modules/internal-events/internal-events.module';

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

    ProfilesModule,
    PostsModule,
    CommentsModule,
    ChatsModule,
    AssetsModule,
    FollowsModule,
    InternalEventsModule,
  ],
})
export class AppModule {}
