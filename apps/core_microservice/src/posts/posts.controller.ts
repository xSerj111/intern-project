import { Controller, Get, Post as HttpPost, Body, Patch, Param, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto, UpdatePostDto } from '@repo/shared';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @HttpPost()
  async createPost(@Body() createPostDto: CreatePostDto) {
    return this.postsService.createPost(createPostDto);
  }

  @Get(':id')
  async getPost(@Param('id') id: string) {
    return this.postsService.getPost(id);
  }

  @Patch(':id')
  async updatePost(
    @Param('id') id: string,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.updatePost(id, updatePostDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // 204 No Content is the standard for successful deletes
  async deletePost(@Param('id') id: string) {
    await this.postsService.softDeletePost(id);
  }


  
}
