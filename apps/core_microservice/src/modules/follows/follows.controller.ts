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
  Query,
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
import { PaginationQueryDto } from './dto/pagination-query.dto';

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

  @Get('users/:userId/followers')
  @ApiOperation({ summary: 'Get paginated list of followers for a user' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  async getFollowersList(
    @CurrentUser('sub') requesterId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query() query: PaginationQueryDto,
  ) {
    // Ustawiamy wartosci domyslne, jesli frontend ich nie poda
    const limit = query.limit || 20;
    // Matematyka paginacji: Strona 1 to offset 0. Strona 2 (przy limicie 20) to offset 20.
    const offset = ((query.page || 1) - 1) * limit;

    return this.followsService.getFollowersList(
      requesterId,
      targetUserId,
      limit,
      offset,
    );
  }

  @Get('users/:userId/following')
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  @ApiOperation({ summary: 'Get paginated list of following for a user' })
  async getFollowingList(
    @CurrentUser('sub') requesterId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const limit = query.limit || 20;
    const offset = ((query.page || 1) - 1) * limit;

    return this.followsService.getFollowingList(
      requesterId,
      targetUserId,
      limit,
      offset,
    );
  }

  @Delete('users/:followingId')
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

  @Post('requests/:followerId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject a pending follow request' })
  async rejectRequest(
    @CurrentUser('sub') userId: string,
    @Param('followerId', ParseUUIDPipe) followerId: string,
  ): Promise<void> {
    await this.followsService.rejectRequest(userId, followerId);
  }
}
