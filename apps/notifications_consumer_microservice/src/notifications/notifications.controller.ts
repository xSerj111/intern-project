import { Controller, Get, Patch, Param, ParseUUIDPipe } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Przyklad wywolania wewnetrznego: GET /notifications/123e4567-e89b-12d3-a456-426614174000
  @Get(':userId')
  async getUserNotifications(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.notificationsService.getUserNotifications(userId);
  }

  // Przyklad wywolania wewnetrznego: PATCH /notifications/123e4567.../987f6543.../read
  @Patch(':userId/:notificationId/read')
  async markAsRead(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }
}
