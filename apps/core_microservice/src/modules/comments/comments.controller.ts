import {
  Controller,
  Get,
  Post as HttpPost,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  Delete,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from '@repo/shared';
import { CommentResponseDto } from './dto/comment-response.dto';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @HttpPost()
  async createComment(
    @Body() createCommentDto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return new CommentResponseDto(
      await this.commentsService.createComment(createCommentDto),
    );
  }

  // Example route: GET /comments/post/1234sd-123d-213132.....
  @Get('post/:postId')
  async getCommentsByPost(
    @Param('postId', ParseUUIDPipe) postId: string,
  ): Promise<CommentResponseDto[]> {
    const comments = await this.commentsService.getCommentsByPost(postId);
    return comments.map((comment) => new CommentResponseDto(comment));
  }

  @Patch(':id')
  async updateComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCommentDto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    return new CommentResponseDto(
      await this.commentsService.updateComment(id, updateCommentDto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.commentsService.softDeleteComment(id);
  }
}
