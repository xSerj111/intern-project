import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    LoggerModule.forFeature('NotificationsService'),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
