import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { RedisModule } from './common/redis/redis.module';
import { CommonAuthModule } from './common/auth/common-auth.module';
import { MetricsModule } from './common/observability/metrics.module';
import { QueryContextMiddleware } from './common/db/query-context';
import { TypeOrmPerfLogger } from './common/db/typeorm-perf.logger';
import { QueryCountInterceptor } from './common/perf/query-count.interceptor';
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
    MetricsModule,
    RedisModule,
    CommonAuthModule,

    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      // Entities are registered by each feature module via TypeOrmModule.forFeature();
      // autoLoadEntities pulls them in, so the root never lists entities itself.
      useFactory: (config: AppConfigService) => ({
        ...config.postgres,
        autoLoadEntities: true,
        // Query logging feeds the per-request query counter; the logger prints nothing for queries.
        logging: ['query', 'error'] as ('query' | 'error')[],
        logger: new TypeOrmPerfLogger(),
        maxQueryExecutionTime: config.slowQueryMs,
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
  providers: [{ provide: APP_INTERCEPTOR, useClass: QueryCountInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QueryContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
