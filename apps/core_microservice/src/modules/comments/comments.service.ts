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
import { CommentThreadNode } from './domain/interfaces/comment-thread-node.interface';

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

  async getCommentsTreeByPost(
    userId: string,
    postId: string,
  ): Promise<CommentThreadNode[]> {
    await this.postVerificationPort.verifyPostAccess(userId, postId);

    const flatComments = await this.commentRepository.findByPost(postId);

    const enriched = await this.enrichCommentsWithLikes(userId, flatComments);

    const commentMap = new Map<string, CommentThreadNode>();

    const rootNodes: CommentThreadNode[] = [];

    enriched.forEach((e) => {
      commentMap.set(e.comment.id, {
        comment: e.comment,
        likesCount: e.likesCount,
        isLiked: e.isLiked,
        replies: [],
      });
    });

    enriched.forEach((e) => {
      const node = commentMap.get(e.comment.id)!;

      if (e.comment.parentId) {
        const parent = commentMap.get(e.comment.parentId);
        if (parent) {
          parent.replies.push(node);
        } else {
          rootNodes.push(node);
        }
      } else {
        rootNodes.push(node);
      }
    });

    this.logger.debug('Comment tree built', {
      props: { postId, rootNodesCount: rootNodes.length },
    });
    return rootNodes;
  }

  async enrichCommentsWithLikes(userId: string, comments: Comment[]) {
    if (comments.length === 0) return [];

    const commentIds = comments.map((c) => c.id);

    const likesData = await this.commentLikeRepository
      .createQueryBuilder('like')
      .select('like.commentId', 'commentId')
      .addSelect('COUNT(like.id)', 'likesCount')
      .addSelect(
        `SUM(CASE WHEN like.userId = :userId THEN 1 ELSE 0 END)`,
        'isLiked',
      )
      .where('like.commentId IN (:...commentIds)', { commentIds })
      .setParameter('userId', userId)
      .groupBy('like.commentId')
      .getRawMany();

    const likesMap = new Map<string, { count: number; isLiked: boolean }>();
    likesData.forEach((data) => {
      likesMap.set(data.commentId, {
        count: parseInt(data.likesCount || '0', 10),
        isLiked: parseInt(data.isLiked || '0', 10) > 0,
      });
    });

    return comments.map((comment) => {
      const stats = likesMap.get(comment.id) || { count: 0, isLiked: false };
      return {
        comment,
        likesCount: stats.count,
        isLiked: stats.isLiked,
      };
    });
  }
}
