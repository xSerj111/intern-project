import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { IFeedPage, IHashtagResult } from '@repo/contracts';
import { PAGE_SIZE_MAX } from '@repo/contracts';
import { PostsService } from './posts.service';
import { PostResponseMapper } from './post-response.mapper';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { SearchHashtagsQueryDto } from './dto/search-hashtags-query.dto';
import { HashtagFeedQueryDto } from './dto/hashtag-feed-query.dto';
import { HashtagParamDto } from './dto/hashtag-param.dto';
import { HashtagResultDto } from './dto/hashtag-result.dto';
import { FeedPageResponseDto } from './dto/feed-page-response.dto';

@ApiTags('hashtags')
@Controller('hashtags')
export class HashtagsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly postResponseMapper: PostResponseMapper,
  ) {}

  // Declared before `:tag/posts` on purpose; keep this order.
  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Suggest hashtags by prefix (token optional)',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Tag prefix, with or without a leading #',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Maximum number of suggestions (1-${PAGE_SIZE_MAX})`,
  })
  @ApiOkResponse({
    description: 'Matching tags with their published post counts',
    type: [HashtagResultDto],
  })
  @ApiBadRequestResponse({ description: 'Invalid q or limit' })
  async searchHashtags(
    @Query() query: SearchHashtagsQueryDto,
  ): Promise<IHashtagResult[]> {
    return this.postsService.searchHashtags(query.q, query.limit);
  }

  @Get(':tag/posts')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cursor-paged published posts carrying a hashtag (token optional)',
  })
  @ApiParam({
    name: 'tag',
    description: 'Hashtag, with or without a leading # (use %23)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque cursor from a previous `nextCursor`',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Number of posts per page (1-${PAGE_SIZE_MAX})`,
  })
  @ApiOkResponse({
    description: 'Cursor page of published posts with the tag',
    type: FeedPageResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid tag, cursor or limit' })
  async getHashtagFeed(
    @CurrentUser('sub') userId: string | undefined,
    @Param() params: HashtagParamDto,
    @Query() query: HashtagFeedQueryDto,
  ): Promise<IFeedPage> {
    const { items, nextCursor } = await this.postsService.getHashtagFeed(
      params.tag,
      query.cursor,
      query.limit,
    );
    return {
      items: await this.postResponseMapper.toResponses(items, userId),
      nextCursor,
    };
  }
}
