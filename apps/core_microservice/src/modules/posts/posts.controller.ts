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
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { FeedQueryDto } from './dto/feed-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @HttpPost()
  @UseGuards(JwtAuthGuard)
  async createPost(
    @CurrentUser('sub') userId: string,
    @Body() createPostDto: CreatePostDto,
  ): Promise<PostResponseDto> {
    console.log('User Id from token:', userId);

    return new PostResponseDto(
      await this.postsService.createPost(userId, createPostDto),
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  async publishPost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(await this.postsService.publishPost(userId, id));
  }

  @HttpPost(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archivePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(await this.postsService.archivePost(userId, id));
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
