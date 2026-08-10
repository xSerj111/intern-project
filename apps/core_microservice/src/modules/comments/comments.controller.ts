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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @HttpPost()
  async createComment(
    @CurrentUser('sub') userId: string,
    @Body() createCommentDto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return new CommentResponseDto(
      await this.commentsService.createComment(userId, createCommentDto),
    );
  }

  // Example route: GET /comments/post/1234sd-123d-213132.....
  @Get('post/:postId')
  @ApiOperation({ summary: 'Get comments thread for a post' })
  async getCommentsByPost(
    @CurrentUser('sub') userId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
  ): Promise<CommentResponseDto[]> {
    const flatComments = await this.commentsService.getCommentsByPost(
      userId,
      postId,
    );

    const enriched = await this.commentsService.enrichCommentsWithLikes(
      userId,
      flatComments,
    );

    const dtos = enriched.map(
      (e) => new CommentResponseDto(e.comment, e.likesCount, e.isLiked),
    );

    const commentMap = new Map<string, CommentResponseDto>();
    const rootComments: CommentResponseDto[] = [];

    dtos.forEach((dto) => {
      if (dto.parentId) {
        const parent = commentMap.get(dto.parentId);
        if (parent) {
          parent.replies?.push(dto);
        } else {
          rootComments.push(dto);
        }
      } else {
        rootComments.push(dto);
      }
    });

    return rootComments;
  }

  @Patch(':id')
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
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.commentsService.softDeleteComment(userId, id);
  }

  @HttpPost(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle like on a comment' })
  async toggleLike(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.commentsService.toggleLike(userId, id);
  }
}
