import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ILikeState } from '@repo/contracts';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LikesService } from './likes.service';

@ApiTags('Likes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Put('posts/:postId/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Like a post (idempotent)' })
  likePost(
    @CurrentUser('sub') userId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
  ): Promise<ILikeState> {
    return this.likesService.likePost(postId, userId);
  }

  @Delete('posts/:postId/like')
  @ApiOperation({ summary: 'Remove your like from a post (idempotent)' })
  unlikePost(
    @CurrentUser('sub') userId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
  ): Promise<ILikeState> {
    return this.likesService.unlikePost(postId, userId);
  }

  @Put('comments/:commentId/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Like a comment (idempotent)' })
  likeComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<ILikeState> {
    return this.likesService.likeComment(commentId, userId);
  }

  @Delete('comments/:commentId/like')
  @ApiOperation({ summary: 'Remove your like from a comment (idempotent)' })
  unlikeComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<ILikeState> {
    return this.likesService.unlikeComment(commentId, userId);
  }
}
