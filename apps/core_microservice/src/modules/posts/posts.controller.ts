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
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto, UpdatePostDto } from '@repo/shared';
import { PostResponseDto } from './dto/post-response.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { FeedQueryDto } from './dto/feed-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @HttpPost()
  async createPost(
    @CurrentUser('sub') userId: string,
    @Body() createPostDto: CreatePostDto,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(
      await this.postsService.createPost(userId, createPostDto),
    );
  }

  @Get('feed')
  async getFeed(
    @CurrentUser('sub') userId: string,
    @Query() query: FeedQueryDto,
  ) {
    const { items, total } = await this.postsService.getFeed(
      userId,
      query.page,
      query.limit,
    );

    const enrichedItems = await this.postsService.enrichPostsWithLikes(
      userId,
      items,
    );

    return {
      items: enrichedItems.map(
        (e) =>
          new PostResponseDto(e.post, {
            likesCount: e.likesCount,
            isLiked: e.isLiked,
          }),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get('search')
  async searchPosts(
    @CurrentUser('sub') userId: string,
    @Query() query: SearchQueryDto,
  ) {
    const { items, total } = await this.postsService.searchPosts(
      query.keyword,
      query.page,
      query.limit,
    );

    const enrichedItems = await this.postsService.enrichPostsWithLikes(
      userId,
      items,
    );

    return {
      items: enrichedItems.map(
        (e) =>
          new PostResponseDto(e.post, {
            likesCount: e.likesCount,
            isLiked: e.isLiked,
          }),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get(':id')
  async getPost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    const post = await this.postsService.getPost(userId, id);

    const [enriched] = await this.postsService.enrichPostsWithLikes(userId, [
      post,
    ]);

    return new PostResponseDto(enriched.post, {
      likesCount: enriched.likesCount,
      isLiked: enriched.isLiked,
    });
  }

  @Patch(':id')
  async updatePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePostDto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(
      await this.postsService.updatePost(userId, id, updatePostDto),
    );
  }

  @HttpPost(':id/publish')
  async publishPost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(await this.postsService.publishPost(userId, id));
  }

  @HttpPost(':id/archive')
  async archivePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(await this.postsService.archivePost(userId, id));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // 204 No Content is the standard for successful deletes
  async deletePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.postsService.softDeletePost(userId, id);
  }

  @HttpPost(':id/like')
  @HttpCode(HttpStatus.OK)
  async toggleLike(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.postsService.toggleLike(userId, id);
  }
}
