import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type ActorSnapshot,
  CreateCommentDto,
  DatabaseQueryError,
  DomainError,
  EntityByIdNotFoundError,
  LoggerKey,
  type Logger,
  type PostCommentedPayload,
  RoutingKeys,
  UpdateCommentDto,
} from '@repo/shared';
import { DataSource, type EntityManager } from 'typeorm';
import {
  OUTBOX_PORT,
  type IOutboxPort,
} from '../../common/messaging/outbox.port';
import type { Post } from '../posts/domain/entities/post.entity';
import {
  USER_DIRECTORY_PORT,
  type IUserDirectoryPort,
} from '../profiles/domain/interfaces/user-directory.port';
import { Comment } from './domain/entities/comment.entity';
import { CommentRepository } from './infrastructure/repository/comment.repository';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly commentRepository: CommentRepository,
    private readonly dataSource: DataSource,
    @Inject(OUTBOX_PORT) private readonly outbox: IOutboxPort,
    @Inject(USER_DIRECTORY_PORT)
    private readonly userDirectory: IUserDirectoryPort,
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
    // String target: the Post entity is registered by PostsModule; no runtime import.
    const post = await this.dataSource
      .getRepository<Post>('Post')
      .findOne({ where: { id: comment.postId } });
    if (!post) {
      throw new EntityByIdNotFoundError('Post', comment.postId);
    }

    const actor = comment.notifiesPostAuthor(post)
      ? await this.loadActor(authorId)
      : null;

    // The outbox row shares the comment's transaction: both commit or neither.
    const savedComment = await this.runInTransaction(async (tx) => {
      const saved = await tx.getRepository(Comment).save(comment);
      if (actor) {
        const payload: PostCommentedPayload = {
          actor,
          recipientId: post.authorId,
          postId: post.id,
          commentId: saved.id,
          excerpt: saved.excerpt(),
        };
        await this.outbox.add(RoutingKeys.POST_COMMENTED, payload, tx);
      }
      return saved;
    });
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
      throw new ForbiddenException(
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
    return updatedComment;
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
      throw new ForbiddenException(
        'You are not allowed to delete this comment',
      );
    }

    await this.commentRepository.softDelete(comment);
    this.logger.debug('Comment soft-deleted', {
      props: { commentId: comment.id },
    });
  }

  /** Snapshot of the acting user for the event; null (event skipped) if they have no profile. */
  private async loadActor(userId: string): Promise<ActorSnapshot | null> {
    const users = await this.userDirectory.getUsers([userId]);
    const user = users.get(userId);
    if (!user) {
      this.logger.warn('Skipping notification: actor has no profile', {
        props: { userId },
      });
      return null;
    }
    return { ...user };
  }

  private async runInTransaction<T>(
    work: (tx: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (err: unknown) {
      if (err instanceof DomainError) throw err;
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new DatabaseQueryError();
    }
  }
}
