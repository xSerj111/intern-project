import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthModule } from './common/auth/common-auth.module';
import { MessagingModule } from './common/messaging/messaging.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { RedisModule } from './common/redis/redis.module';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PreferencesModule } from './modules/preferences/preferences.module';

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        ...config.postgres,
        // innogram_notifications; schema changes go through migrations only.
        synchronize: false,
        autoLoadEntities: true,
      }),
    }),
    RedisModule,
    CommonAuthModule,
    MessagingModule,
    PreferencesModule,
    NotificationsModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
