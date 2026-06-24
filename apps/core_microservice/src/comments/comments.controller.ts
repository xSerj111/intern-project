import { Controller, Get, Post as HttpPost, Body, Patch, Param, Delete, HttpStatus, HttpCode } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from '@repo/shared';


@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @HttpPost()
  async createComment(@Body() createCommentDto: CreateCommentDto) {
    return this.commentsService.createComment(createCommentDto);
  }

  // Example route: GET /comments/post/1234sd-123d-213132.....
  @Get('post/:postId')
  async getCommentsByPost(@Param('postId') postId: string) {
    return this.commentsService.getCommentsByPost(postId);
  }

  @Patch(':id')
  async updateComment(
    @Param('id') id: string,
    @Body() updateCommentDto: UpdateCommentDto,
  ) {
    return this.commentsService.updateComment(id, updateCommentDto);
  }


  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(@Param('id') id: string) {
    return this.commentsService.softDeleteComment(id);
  }

  
}
