import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { MarkSeenDto } from './dto/mark-seen.dto';
import {
  NotificationsPageResponseDto,
  UnseenCountResponseDto,
} from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

/** Every route is scoped to the caller (`user.sub`); no recipient id is accepted from the request. */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationsPageResponseDto> {
    return this.notificationsService.list(userId, query);
  }

  @Get('unseen-count')
  unseenCount(
    @CurrentUser('sub') userId: string,
  ): Promise<UnseenCountResponseDto> {
    return this.notificationsService.unseenCount(userId);
  }

  @Post('seen')
  @HttpCode(HttpStatus.OK)
  markSeen(
    @CurrentUser('sub') userId: string,
    @Body() body: MarkSeenDto,
  ): Promise<UnseenCountResponseDto> {
    return this.notificationsService.markSeen(userId, body.upTo);
  }
}
