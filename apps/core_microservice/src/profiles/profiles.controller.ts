import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from '@repo/shared';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // Temporary endpoint for testing
  @ApiOperation({ summary: 'Create a new profile' })
  @Post()
  async createProfile(@Body('authUserId') authUserId: string, @Body('handle') handle: string) {
    return this.profilesService.createProfile(authUserId, handle);
  }

  @ApiOperation({ summary: 'Fetch a profile by ID' })
  @Get(':id')
  async getProfile(@Param('id') id: string) {
    return this.profilesService.getProfile(id);
  }

  @ApiOperation({ summary: 'Update profile' })
  @Patch(':id')
  async updateProfile(
    @Param('id') id: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.profilesService.updateProfile(id, updateProfileDto);
  }

}
