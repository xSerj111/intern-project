import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PreferencesResponseDto } from './dto/preferences-response.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferencesService } from './preferences.service';

/** Scoped to the caller (`user.sub`). */
@Controller('notifications/preferences')
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  get(@CurrentUser('sub') userId: string): Promise<PreferencesResponseDto> {
    return this.preferencesService.get(userId);
  }

  @Put()
  update(
    @CurrentUser('sub') userId: string,
    @Body() body: UpdatePreferencesDto,
  ): Promise<PreferencesResponseDto> {
    return this.preferencesService.update(userId, body);
  }
}
