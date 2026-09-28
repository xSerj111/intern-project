import { Inject, Injectable } from '@nestjs/common';
import {
  CreateCommentDto,
  LoggerKey,
  type Logger,
  UnauthorizedError,
  UpdateCommentDto,
} from '@repo/shared';
import { Comment } from './domain/entities/comment.entity';
import { CommentRepository } from './infrastructure/repository/comment.repository';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly commentRepository: CommentRepository,
  ) {}

  async createComment(
    authorId: string,
    createCommentDto: CreateCommentDto,
  ): Promise<Comment> {
    const comment = Comment.create({
      authorId,
      postId: createCommentDto.postId,
      parentId: createCommentDto.parentId,
      content: createCommentDto.content,
    });
    const savedComment = await this.commentRepository.save(comment);
    this.logger.debug('Comment created', {
      props: { commentId: savedComment.id },
    });
    // Re-read with the author joined so the response includes the author summary.
    return this.commentRepository.findOneByIdOrThrow(savedComment.id, [
      'author',
    ]);
  }

  async updateComment(
    userId: string,
    id: string,
    updateCommentDto: UpdateCommentDto,
  ): Promise<Comment> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);

    if (comment.authorId !== userId) {
      throw new UnauthorizedError(
        'You are not allowed to update this comment',
      );
    }

    if (updateCommentDto.content !== undefined) {
      comment.edit(updateCommentDto.content);
    }
    const updatedComment = await this.commentRepository.save(comment);
    this.logger.debug('Comment updated', {
      props: { commentId: updatedComment.id },
    });
    return this.commentRepository.findOneByIdOrThrow(updatedComment.id, [
      'author',
    ]);
  }

  // We return an array of comments here (newest first, with author joined)
  async getCommentsByPost(postId: string): Promise<Comment[]> {
    const comments = await this.commentRepository.findByPost(postId);
    this.logger.debug('Comments retrieved', {
      props: { postId, count: comments.length },
    });
    return comments;
  }

  async softDeleteComment(userId: string, id: string): Promise<void> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);

    if (comment.authorId !== userId) {
      throw new UnauthorizedError(
        'You are not allowed to delete this comment',
      );
    }

    await this.commentRepository.softDelete(comment);
    this.logger.debug('Comment soft-deleted', {
      props: { commentId: comment.id },
    });
  }
}
