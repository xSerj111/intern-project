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
  UseGuards,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from '@repo/shared';
import { CommentResponseDto } from './dto/comment-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @HttpPost()
  @UseGuards(JwtAuthGuard)
  async createComment(
    @CurrentUser('sub') authorId: string,
    @Body() createCommentDto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return new CommentResponseDto(
      await this.commentsService.createComment(authorId, createCommentDto),
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
  @UseGuards(JwtAuthGuard)
  async updateComment(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCommentDto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    return new CommentResponseDto(
      await this.commentsService.updateComment(userId, id, updateCommentDto),
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.commentsService.softDeleteComment(userId, id);
  }
}
