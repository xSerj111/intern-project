import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from '@repo/shared';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { ProfileUserResponseDto } from './dto/profile-user-response.dto';
import { SearchProfilesQueryDto } from './dto/search-profiles-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/** Max auth user ids accepted by one batch lookup. */
const MAX_LOOKUP_IDS = 100;

/** Accepts `ids=a,b` and repeated `ids=a&ids=b`; trims and de-duplicates. */
function toUniqueIds({ value }: { value: unknown }): unknown {
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  if (!raw.every((v) => typeof v === 'string')) return value;
  const ids = raw
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export class UsersByIdsQueryDto {
  @ApiProperty({
    description: 'Comma-separated auth user ids (UUIDs)',
    type: String,
    example: '3f2b...,9a1c...',
  })
  @Transform(toUniqueIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOOKUP_IDS)
  @IsUUID('all', { each: true })
  ids!: string[];
}

@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Fetch the authenticated user profile' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
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
  @ApiOperation({
    summary: 'Search users whose username or display name contains the query',
  })
  @ApiOkResponse({ type: [ProfileUserResponseDto] })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @Get('search')
  async searchProfiles(
    @Query() query: SearchProfilesQueryDto,
    @CurrentUser('sub') authUserId: string,
  ): Promise<ProfileUserResponseDto[]> {
    return this.profilesService.searchProfiles(
      query.q,
      query.limit,
      authUserId,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Batch-resolve users by auth user id' })
  @ApiOkResponse({ type: [ProfileUserResponseDto] })
  @ApiBadRequestResponse({ description: 'Missing, malformed or too many ids' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @Get('by-users')
  async getUsersByIds(
    @Query() query: UsersByIdsQueryDto,
  ): Promise<ProfileUserResponseDto[]> {
    return this.profilesService.getUsersByIds(query.ids);
  }

  @ApiOperation({ summary: 'Fetch a profile by ID' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({ description: 'id is not a UUID' })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  @Get(':id')
  async getProfile(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProfileResponseDto> {
    return new ProfileResponseDto(await this.profilesService.getProfile(id));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update profile' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid body, display name, bio or avatar asset',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({
    description: 'Not the profile owner, or avatar asset not owned by caller',
  })
  @ApiNotFoundResponse({ description: 'Profile or avatar asset not found' })
  @Patch(':id')
  async updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateProfileDto: UpdateProfileDto,
    @CurrentUser('sub') authUserId: string,
  ): Promise<ProfileResponseDto> {
    // Ownership (403) is enforced by the entity inside the service.
    const updatedProfile = await this.profilesService.updateProfile(
      id,
      updateProfileDto,
      authUserId,
    );
    return new ProfileResponseDto(updatedProfile);
  }
}
