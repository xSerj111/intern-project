import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PreferencesResponseDto } from './dto/preferences-response.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferencesService } from './preferences.service';

/** Scoped to the caller (`user.sub`). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications/preferences')
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Get your notification preferences' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current notification preferences',
    type: PreferencesResponseDto,
  })
  get(@CurrentUser('sub') userId: string): Promise<PreferencesResponseDto> {
    return this.preferencesService.get(userId);
  }

  @Put()
  @ApiOperation({ summary: 'Update your notification preferences' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Preferences after the update',
    type: PreferencesResponseDto,
  })
  update(
    @CurrentUser('sub') userId: string,
    @Body() body: UpdatePreferencesDto,
  ): Promise<PreferencesResponseDto> {
    return this.preferencesService.update(userId, body);
  }
}
