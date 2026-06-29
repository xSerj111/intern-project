import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FollowsService } from './follows.service';
import { CreateFollowDto } from './dto/create-follow.dto';
import { FollowResponseDto } from './dto/follow-response.dto';

@ApiTags('Follows')
@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post()
  @ApiOperation({ summary: 'Start to follow user' })
  @ApiResponse({ status: 201, type: FollowResponseDto })
  async follow(@Body() createFollowDto: CreateFollowDto): Promise<FollowResponseDto> {
    //TODO: Change temp ID with value extracted from JWT token after integration of authorization
    const TEMP_FOLLOWER_ID = '123e4567-e89b-12d3-a456-426614174000';

    const follow = await this.followsService.follow(TEMP_FOLLOWER_ID, createFollowDto.followingId);
    return new FollowResponseDto(follow) // translate typeORM entity for JSON contract

  }

  @Get(':userId/followers')
  @ApiOperation({ summary: 'Get the list of followers for that user' })
  async getFollowers(@Param('userId', ParseUUIDPipe) userId: string): Promise<FollowResponseDto[]> {
    const followers = await this.followsService.getFollowers(userId);
    return followers.map(f => new FollowResponseDto(f));
  }

  @Get(':userId/following')
  @ApiOperation({ summary: 'Get the list of users followed by the user' })
  async getFollowing(@Param('userId', ParseUUIDPipe) userId: string): Promise<FollowResponseDto[]> {
    const following = await this.followsService.getFollowing(userId);
    return following.map(f => new FollowResponseDto(f));
  }

  @Delete(':followingId')
  @ApiOperation({ summary: 'Unfollow a user' })
  async unfollow(@Param('followingId', ParseUUIDPipe) followingId: string): Promise<void> {
    const TEMP_FOLLOWER_ID = '123e4567-e89b-12d3-a456-426614174000';
    return this.followsService.unfollow(TEMP_FOLLOWER_ID, followingId);
  }
}
