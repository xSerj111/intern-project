import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FollowsService } from './follows.service';
import { CreateFollowDto } from './dto/create-follow.dto';
import { FollowResponseDto } from './dto/follow-response.dto';
import { FollowPageResponseDto } from './dto/follow-list-item-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { ListFollowsQueryDto } from './dto/list-follows-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Follows')
@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start to follow user' })
  @ApiResponse({ status: 201, type: FollowResponseDto })
  @ApiBadRequestResponse({ description: 'followingId is not a UUID' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
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
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a page of followers for that user' })
  @ApiOkResponse({ type: FollowPageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid userId or paging query' })
  getFollowers(
    @CurrentUser('sub') viewerId: string | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: ListFollowsQueryDto,
  ): Promise<FollowPageResponseDto> {
    return this.followsService.getFollowers(userId, query, viewerId);
  }

  @Get(':userId/following')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a page of users followed by the user' })
  @ApiOkResponse({ type: FollowPageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid userId or paging query' })
  getFollowing(
    @CurrentUser('sub') viewerId: string | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: ListFollowsQueryDto,
  ): Promise<FollowPageResponseDto> {
    return this.followsService.getFollowing(userId, query, viewerId);
  }

  @Delete(':followingId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiOkResponse({
    description: 'Unfollowed (idempotent: also 200 when not following)',
    schema: { type: 'object', description: 'Empty body' },
  })
  @ApiBadRequestResponse({ description: 'followingId is not a UUID' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async unfollow(
    @CurrentUser('sub') followerId: string,
    @Param('followingId', ParseUUIDPipe) followingId: string,
  ): Promise<void> {
    return this.followsService.unfollow(followerId, followingId);
  }
}
