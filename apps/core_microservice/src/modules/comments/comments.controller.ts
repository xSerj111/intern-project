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
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from '@repo/shared';
import type { IOffsetPage } from '@repo/contracts';
import { CommentResponseDto } from './dto/comment-response.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { Comment } from './domain/entities/comment.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  /** Wraps comments with like counts, the viewer's own like and authors (authors come from the joined relation). */
  private async toResponses(
    comments: Comment[],
    viewerId?: string,
  ): Promise<CommentResponseDto[]> {
    const stats = await this.commentsService.getLikeStats(
      comments.map((comment) => comment.id),
      viewerId,
    );
    const authors = this.commentsService.getAuthors(comments);
    return comments.map(
      (comment) =>
        new CommentResponseDto(
          comment,
          stats.get(comment.id) ?? { likeCount: 0, likedByMe: false },
          authors.get(comment.authorId),
        ),
    );
  }

  private async toResponse(
    comment: Comment,
    viewerId?: string,
  ): Promise<CommentResponseDto> {
    return (await this.toResponses([comment], viewerId))[0];
  }

  @HttpPost()
  @UseGuards(JwtAuthGuard)
  async createComment(
    @CurrentUser('sub') authorId: string,
    @Body() createCommentDto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.toResponse(
      await this.commentsService.createComment(authorId, createCommentDto),
      authorId,
    );
  }

  // GET /comments/post/:postId?page=1&limit=20 (paged by root comments)
  @Get('post/:postId')
  @UseGuards(OptionalJwtAuthGuard)
  async getCommentsByPost(
    @CurrentUser('sub') userId: string | undefined,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: ListCommentsQueryDto,
  ): Promise<IOffsetPage<CommentResponseDto>> {
    const { items, page, limit, hasMore } =
      await this.commentsService.getCommentsByPost(postId, query);
    return {
      items: await this.toResponses(items, userId),
      page,
      limit,
      hasMore,
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updateComment(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCommentDto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.toResponse(
      await this.commentsService.updateComment(userId, id, updateCommentDto),
      userId,
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
