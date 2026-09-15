import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ProfilesService } from '../profiles/profiles.service';
import { UserCreatedEvent } from '@repo/shared';

@ApiExcludeController()
@Controller('internal/events')
export class InternalEventsController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post('user-created')
  @HttpCode(HttpStatus.OK)
  async handleUserCreated(@Body() event: UserCreatedEvent): Promise<void> {
    // Orkiestracja zdarzenia - tutaj zlecamy zadania różnym modułom
    await this.profilesService.createProfile(event.authUserId, event.handle);

    // W przyszłości dodasz tu po prostu:
    // await this.settingsService.initDefaults(event.authUserId);
    // await this.notificationService.sendWelcome(event.email);
  }
}
