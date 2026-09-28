import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FollowsService } from './follows.service';
import { CreateFollowDto } from './dto/create-follow.dto';
import { FollowResponseDto } from './dto/follow-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Follows')
@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Start to follow user' })
  @ApiResponse({ status: 201, type: FollowResponseDto })
  async follow(
    @CurrentUser('sub') followerId: string,
    @Body() createFollowDto: CreateFollowDto,
  ): Promise<FollowResponseDto> {
    const follow = await this.followsService.follow(
      followerId,
      createFollowDto.followingId,
    );
    return new FollowResponseDto(follow); // translate typeORM entity for JSON contract
  }

  @Get(':userId/followers')
  @ApiOperation({ summary: 'Get the list of followers for that user' })
  async getFollowers(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<FollowResponseDto[]> {
    const followers = await this.followsService.getFollowers(userId);
    return followers.map((f) => new FollowResponseDto(f));
  }

  @Get(':userId/following')
  @ApiOperation({ summary: 'Get the list of users followed by the user' })
  async getFollowing(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<FollowResponseDto[]> {
    const following = await this.followsService.getFollowing(userId);
    return following.map((f) => new FollowResponseDto(f));
  }

  @Delete(':followingId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unfollow a user' })
  async unfollow(
    @CurrentUser('sub') followerId: string,
    @Param('followingId', ParseUUIDPipe) followingId: string,
  ): Promise<void> {
    return this.followsService.unfollow(followerId, followingId);
  }
}
