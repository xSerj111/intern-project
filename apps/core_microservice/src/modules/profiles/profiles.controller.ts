import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  UseGuards,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from '@repo/shared';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileResponseDto } from './dto/profile-response.dto';
import type { IChatUser } from '@repo/contracts';
import { SearchProfilesQueryDto } from './dto/search-profiles-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Fetch the authenticated user profile' })
  @Get('me')
  async getMyProfile(
    @CurrentUser() user: { sub: string; email: string },
  ): Promise<ProfileResponseDto> {
    return new ProfileResponseDto(
      await this.profilesService.getOrCreateProfileByAuthUserId(
        user.sub,
        user.email,
      ),
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Search users by username prefix' })
  @Get('search')
  async searchProfiles(
    @Query() query: SearchProfilesQueryDto,
    @CurrentUser('sub') authUserId: string,
  ): Promise<IChatUser[]> {
    return this.profilesService.searchProfiles(
      query.q,
      query.limit,
      authUserId,
    );
  }

  @ApiOperation({ summary: 'Fetch a profile by ID' })
  @Get(':id')
  async getProfile(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProfileResponseDto> {
    return new ProfileResponseDto(await this.profilesService.getProfile(id));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update profile' })
  @Patch(':id')
  async updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateProfileDto: UpdateProfileDto,
    @CurrentUser('sub') authUserId: string,
  ): Promise<ProfileResponseDto> {
    const profile = await this.profilesService.getProfile(id);

    if (profile.authUserId !== authUserId) {
      throw new ForbiddenException('You can only update your profile');
    }

    const updatedProfile = await this.profilesService.updateProfile(
      id,
      updateProfileDto,
    );
    return new ProfileResponseDto(updatedProfile);
  }
}
