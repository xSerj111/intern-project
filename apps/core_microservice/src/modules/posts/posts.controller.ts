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
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto, UpdatePostDto } from '@repo/shared';
import { PostResponseDto } from './dto/post-response.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // 204 No Content is the standard for successful deletes
  async deletePost(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.postsService.softDeletePost(userId, id);
  }
}
