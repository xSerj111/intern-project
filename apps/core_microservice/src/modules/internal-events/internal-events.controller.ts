import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalTokenGuard } from '../../common/observability/internal-token.guard';
import { ProfilesService } from '../profiles/profiles.service';
import { UserCreatedEvent } from '@repo/shared';

/** Service-to-service events from auth; requires `X-Internal-Token`. */
@ApiExcludeController()
@Controller('internal/events')
export class InternalEventsController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post('user-created')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalTokenGuard)
  async handleUserCreated(@Body() event: UserCreatedEvent): Promise<void> {
    // Creates the user's profile (idempotent for replayed events).
    await this.profilesService.createProfile(event.authUserId, event.handle);
  }
}
