import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from '@repo/shared';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { CreateProfileDto } from './dto/create-profile.dto';

@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @ApiOperation({ summary: 'Create a new profile' })
  @Post()
  async createProfile(
    @Body() createProfileDto: CreateProfileDto,
  ): Promise<ProfileResponseDto> {
    const profile = await this.profilesService.createProfile(
      createProfileDto.authUserId,
      createProfileDto.handle,
    );
    return new ProfileResponseDto(profile);
  }

  @ApiOperation({ summary: 'Fetch a profile by ID' })
  @Get(':id')
  async getProfile(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProfileResponseDto> {
    return new ProfileResponseDto(await this.profilesService.getProfile(id));
  }

  @ApiOperation({ summary: 'Update profile' })
  @Patch(':id')
  async updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const profile = await this.profilesService.updateProfile(
      id,
      updateProfileDto,
    );
    return new ProfileResponseDto(profile);
  }
}
