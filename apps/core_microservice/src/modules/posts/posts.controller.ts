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
import { Post } from './domain/entities/post.entity';
import { PostRepository } from './infrastructure/repository/post.repository';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly postRepository: PostRepository,
  ) {}

  /** Wraps posts with like counts and the viewer's own like (one query). */
  private async toResponses(
    posts: Post[],
    viewerId?: string,
  ): Promise<PostResponseDto[]> {
    const stats = await this.postRepository.getLikeStats(
      posts.map((post) => post.id),
      viewerId,
    );
    return posts.map(
      (post) =>
        new PostResponseDto(
          post,
          stats.get(post.id) ?? { likeCount: 0, likedByMe: false },
        ),
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
    console.log('User Id from token:', userId);

    return this.toResponse(
      await this.postsService.createPost(userId, createPostDto),
      userId,
    );
  }

  @Get('feed')
  @UseGuards(JwtAuthGuard)
  async getFeed(
    @CurrentUser('sub') userId: string,
    @Query() query: FeedQueryDto,
  ) {
    const { items, total } = await this.postsService.getFeed(
      userId,
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
