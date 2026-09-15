import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { LoggerModule } from '@repo/shared';
import { Notification } from '../entities/notification.entity';

@Module({
  imports: [
    LoggerModule.forFeature('NotificationsService'),
    TypeOrmModule.forFeature([Notification]), // <--- TO JEST KRYTYCZNE
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
