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
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeedQueryDto } from './dto/feed-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { Post, PostStatus } from './domain/entities/post.entity';
import { PostsByAuthorQueryDto } from '@repo/shared';
import type { IFeedPage } from '@repo/contracts';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  /** Wraps posts with like/comment counts and the viewer's own like (one query each). */
  private async toResponses(
    posts: Post[],
    viewerId?: string,
  ): Promise<PostResponseDto[]> {
    const ids = posts.map((post) => post.id);
    const [likes, commentCounts] = await Promise.all([
      this.postsService.getLikeStats(ids, viewerId),
      this.postsService.getCommentCounts(ids),
    ]);
    return posts.map(
      (post) =>
        new PostResponseDto(post, {
          ...(likes.get(post.id) ?? { likeCount: 0, likedByMe: false }),
          commentCount: commentCounts.get(post.id) ?? 0,
        }),
    );
  }

  private async toResponse(
    post: Post,
    viewerId?: string,
  ): Promise<PostResponseDto> {
    return (await this.toResponses([post], viewerId))[0];
  }

  @HttpPost()
  @UseGuards(JwtAuthGuard)
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
  async getFeed(
    @CurrentUser('sub') userId: string,
    @Query() query: FeedQueryDto,
  ): Promise<IFeedPage> {
    const { items, nextCursor } = await this.postsService.getFeed(
      userId,
      query.cursor,
      query.limit,
    );
    return { items: await this.toResponses(items, userId), nextCursor };
  }

  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  async searchPosts(
    @CurrentUser('sub') userId: string | undefined,
    @Query() query: SearchQueryDto,
  ) {
    const { items, total } = await this.postsService.searchPosts(
      query.keyword,
      query.page,
      query.limit,
    );

    return {
      items: await this.toResponses(items, userId),
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
      items: await this.toResponses(items, viewerId),
      total,
      page: query.page,
      limit: query.limit,
      hasMore: query.page * query.limit < total,
    };
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async getPost(
    @CurrentUser('sub') userId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return this.toResponse(await this.postsService.getPost(id), userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updatePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePostDto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return this.toResponse(
      await this.postsService.updatePost(userId, id, updatePostDto),
      userId,
    );
  }

  @HttpPost(':id/publish')
  @UseGuards(JwtAuthGuard)
  async publishPost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return this.toResponse(
      await this.postsService.publishPost(userId, id),
      userId,
    );
  }

  @HttpPost(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archivePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return this.toResponse(
      await this.postsService.archivePost(userId, id),
      userId,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT) // 204 No Content is the standard for successful deletes
  async deletePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.postsService.softDeletePost(userId, id);
  }
}
