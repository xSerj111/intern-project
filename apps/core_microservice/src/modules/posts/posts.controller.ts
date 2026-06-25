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

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @HttpPost()
  async createPost(
    @Body() createPostDto: CreatePostDto,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(
      await this.postsService.createPost(createPostDto),
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePostDto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(
      await this.postsService.updatePost(id, updatePostDto),
    );
  }

  @HttpPost(':id/publish')
  async publishPost(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostResponseDto> {
    return new PostResponseDto(await this.postsService.publishPost(id));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // 204 No Content is the standard for successful deletes
  async deletePost(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.postsService.softDeletePost(id);
  }
}
