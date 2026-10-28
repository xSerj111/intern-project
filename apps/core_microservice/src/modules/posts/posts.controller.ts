import {
  Controller,
  Get,
  Post as HttpPost,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { PostResponseMapper } from './post-response.mapper';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeedQueryDto } from './dto/feed-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { PostStatus } from './domain/entities/post.entity';
import { PostsByAuthorQueryDto } from '@repo/shared';
import type { IFeedPage, IPostSearchPage } from '@repo/contracts';
import { FeedPageResponseDto } from './dto/feed-page-response.dto';
import { PostSearchResponseDto } from './dto/post-search-response.dto';
import { AuthorPostsResponseDto } from './dto/author-posts-response.dto';

@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly postResponseMapper: PostResponseMapper,
  ) {}

  @HttpPost()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a draft post' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Post created',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid body or attachments' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'An attached asset does not exist' })
  async createPost(
    @CurrentUser('sub') userId: string,
    @Body() createPostDto: CreatePostDto,
  ): Promise<PostResponseDto> {
    const post = await this.postsService.createPost(userId, createPostDto);
    // A new post has no likes or comments yet: skip the enrichment queries.
    return new PostResponseDto(post, {
      likeCount: 0,
      commentCount: 0,
      likedByMe: false,
    });
  }

  @Get('feed')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cursor-paged feed of followed authors' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cursor page of published posts',
    type: FeedPageResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid cursor or limit' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getFeed(
    @CurrentUser('sub') userId: string,
    @Query() query: FeedQueryDto,
  ): Promise<IFeedPage> {
    const { items, nextCursor } = await this.postsService.getFeed(
      userId,
      query.cursor,
      query.limit,
    );
    return {
      items: await this.postResponseMapper.toResponses(items, userId),
      nextCursor,
    };
  }

  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Search published posts by keyword (token optional)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Offset page of matching posts',
    type: PostSearchResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid keyword, page or limit' })
  async searchPosts(
    @CurrentUser('sub') userId: string | undefined,
    @Query() query: SearchQueryDto,
  ): Promise<IPostSearchPage> {
    const { items, total } = await this.postsService.searchPosts(
      query.keyword,
      query.page,
      query.limit,
    );

    return {
      items: await this.postResponseMapper.toResponses(items, userId),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * `userId` is the author's auth user id. Published posts are public (the
   * viewer's `likedByMe` is filled when a valid token is sent); draft/archived
   * are only returned to the author, everyone else gets 403.
   */
  @Get('author/:userId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List an author's posts (token optional)" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Offset page of posts by status',
    type: AuthorPostsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid user id, status or paging' })
  @ApiForbiddenResponse({
    description: 'Draft or archived posts requested by someone else',
  })
  async getPostsByAuthor(
    @CurrentUser('sub') viewerId: string | undefined,
    @Param('userId', ParseUUIDPipe) authorId: string,
    @Query() query: PostsByAuthorQueryDto,
  ) {
    const { items, total } = await this.postsService.getPostsByAuthor(
      authorId,
      query.status as PostStatus,
      query.page,
      query.limit,
      viewerId,
    );
    return {
      items: await this.postResponseMapper.toResponses(items, viewerId),
      total,
      page: query.page,
      limit: query.limit,
      hasMore: query.page * query.limit < total,
    };
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a post by id (token optional)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The post',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid post id' })
  @ApiNotFoundResponse({ description: 'Post not found' })
  async getPost(
    @CurrentUser('sub') userId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return this.postResponseMapper.toResponse(
      await this.postsService.getPost(id),
      userId,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a post (author only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Post after the update',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid post id, body or attachments',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Caller is not the author' })
  @ApiNotFoundResponse({ description: 'Post not found' })
  async updatePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePostDto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return this.postResponseMapper.toResponse(
      await this.postsService.updatePost(userId, id, updatePostDto),
      userId,
    );
  }

  @HttpPost(':id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a draft post (author only)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Post after publishing',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid id or post is not a draft' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Caller is not the author' })
  @ApiNotFoundResponse({ description: 'Post not found' })
  async publishPost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return this.postResponseMapper.toResponse(
      await this.postsService.publishPost(userId, id),
      userId,
    );
  }

  @HttpPost(':id/archive')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archive a published post (author only)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Post after archiving',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid id or post is not published',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Caller is not the author' })
  @ApiNotFoundResponse({ description: 'Post not found' })
  async archivePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return this.postResponseMapper.toResponse(
      await this.postsService.archivePost(userId, id),
      userId,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT) // 204 No Content is the standard for successful deletes
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a post (author only)' })
  @ApiNoContentResponse({ description: 'Post deleted' })
  @ApiBadRequestResponse({ description: 'Invalid post id' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Caller is not the author' })
  @ApiNotFoundResponse({ description: 'Post not found' })
  async deletePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.postsService.softDeletePost(userId, id);
  }
}
