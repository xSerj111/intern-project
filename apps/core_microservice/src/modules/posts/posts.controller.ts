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
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
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
    return {
      items: items.map((post) => new PostResponseDto(post)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get('search')
  async searchPosts(@Query() query: SearchQueryDto) {
    const { items, total } = await this.postsService.searchPosts(
      query.keyword,
      query.page,
      query.limit,
    );

    return {
      items: items.map((post) => new PostResponseDto(post)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get(':id')
  async getPost(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(await this.postsService.getPost(id));
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
}
