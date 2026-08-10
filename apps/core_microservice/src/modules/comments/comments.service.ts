import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateCommentDto,
  LoggerKey,
  type Logger,
  UpdateCommentDto,
} from '@repo/shared';
import { Comment } from './domain/entities/comment.entity';
import { CommentRepository } from './infrastructure/repository/comment.repository';
import type { IPostVerificationPort } from './domain/interfaces/post-verification.port';
import { PostVerificationPortKey } from './domain/interfaces/post-verification.port';
import { InjectRepository } from '@nestjs/typeorm';
import { CommentLike } from './domain/entities/comment-like.entity';
import { Repository } from 'typeorm';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly commentRepository: CommentRepository,
    @Inject(PostVerificationPortKey)
    private readonly postVerificationPort: IPostVerificationPort,
    @InjectRepository(CommentLike)
    private readonly commentLikeRepository: Repository<CommentLike>,
  ) {}

  async createComment(
    userId: string,
    createCommentDto: CreateCommentDto,
  ): Promise<Comment> {
    await this.postVerificationPort.verifyPostAccess(
      userId,
      createCommentDto.postId,
    );
    const comment = Comment.create({
      authorId: userId,
      postId: createCommentDto.postId,
      parentId: createCommentDto.parentId,
      content: createCommentDto.content,
    });
    const savedComment = await this.commentRepository.save(comment);
    this.logger.debug('Comment created', {
      props: { commentId: savedComment.id },
    });
    return savedComment;
  }

  async updateComment(
    userId: string,
    id: string,
    updateCommentDto: UpdateCommentDto,
  ): Promise<Comment> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);

    if (comment.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own comments.');
    }
    if (updateCommentDto.content !== undefined) {
      comment.edit(updateCommentDto.content);
    }
    const updatedComment = await this.commentRepository.save(comment);
    this.logger.debug('Comment updated', {
      props: { commentId: updatedComment.id },
    });
    return updatedComment;
  }

  // We return an array of comments here (newest first, with author joined)
  async getCommentsByPost(userId: string, postId: string): Promise<Comment[]> {
    await this.postVerificationPort.verifyPostAccess(userId, postId);

    const comments = await this.commentRepository.findByPost(postId);
    this.logger.debug('Comments retrieved', {
      props: { postId, count: comments.length },
    });
    return comments;
  }

  async softDeleteComment(userId: string, id: string): Promise<void> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    const isCommentAuthor = comment.authorId === userId;
    const isPostAuthor = comment.post?.authorId === userId;

    if (!isCommentAuthor && !isPostAuthor) {
      this.logger.warn('Unauthorized comment deletion attempt', {
        props: { userId, commentId: id },
      });
      throw new ForbiddenException(
        'You do not have permission to delete this comment.',
      );
    }
    await this.commentRepository.softDelete(comment);
    this.logger.debug('Comment soft-deleted', {
      props: { commentId: comment.id },
    });
  }

  async toggleLike(userId: string, commentId: string): Promise<void> {
    await this.commentRepository.findOneByIdOrThrow(commentId);

    const existingLike = await this.commentLikeRepository.findOne({
      where: { userId, commentId },
      withDeleted: true,
    });

    if (existingLike) {
      if (existingLike.deletedAt) {
        await this.commentLikeRepository.restore(existingLike.id);
        this.logger.debug('Comment like restored', {
          props: { commentId, userId },
        });
      } else {
        await this.commentLikeRepository.softRemove(existingLike);
        this.logger.debug('Comment like soft-removed', {
          props: { commentId, userId },
        });
      }
    } else {
      const newLike = this.commentLikeRepository.create({ userId, commentId });
      await this.commentLikeRepository.save(newLike);
      this.logger.debug('Comment liked', { props: { commentId, userId } });
    }
  }
}
