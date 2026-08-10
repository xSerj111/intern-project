import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FollowsService } from './follows.service';
import { CreateFollowDto } from './dto/create-follow.dto';
import { FollowResponseDto } from './dto/follow-response.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@ApiTags('Follows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post()
  @ApiOperation({ summary: 'Start to follow user' })
  @ApiResponse({ status: 201, type: FollowResponseDto })
  async follow(
    @CurrentUser('sub') followerId: string,
    @Body()
    createFollowDto: CreateFollowDto,
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unfollow a user' })
  async unfollow(
    @CurrentUser('sub') followerId: string,
    @Param('followingId', ParseUUIDPipe) followingId: string,
  ): Promise<void> {
    return this.followsService.unfollow(followerId, followingId);
  }

  @Get('requests')
  @ApiOperation({
    summary: 'Get pending follow requests (for private profiles',
  })
  async getRequests(
    @CurrentUser('sub') userId: string,
  ): Promise<FollowResponseDto[]> {
    const requests = await this.followsService.getPendingRequests(userId);
    return requests.map((req) => new FollowResponseDto(req));
  }

  @Post('requests/:followerId/accept')
  @ApiOperation({ summary: 'Accept a pending follow request' })
  async acceptRequest(
    @CurrentUser('sub') userId: string,
    @Param('followerId', ParseUUIDPipe) followerId: string,
  ): Promise<FollowResponseDto> {
    const follow = await this.followsService.acceptRequest(userId, followerId);
    return new FollowResponseDto(follow);
  }

  @Post('request/:followerId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject a pending follow request' })
  async rejectRequest(
    @CurrentUser('sub') userId: string,
    @Param('followerId', ParseUUIDPipe) followerId: string,
  ): Promise<void> {
    await this.followsService.rejectRequest(userId, followerId);
  }
}
