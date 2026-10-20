import type { RepositoryPort } from '@repo/shared';
import type { EntityManager } from 'typeorm';
import type { LikeStats } from '../../../posts/domain/interfaces/post-repository.port';
import type { Comment } from '../entities/comment.entity';
import type { CommentProps } from './comment.props';

/** Opaque transaction handle shared with the outbox port. */
export type CommentTransaction = EntityManager;

export interface ICommentRepository extends RepositoryPort<
  Comment,
  CommentProps
> {
  /** Comments for a post, newest first, with the author profile joined. */
  findByPost(postId: string): Promise<Comment[]>;
  /**
   * Like stats for each requested comment (every id gets an entry);
   * `viewerId` is undefined for anonymous requests (`likedByMe: false`).
   */
  getLikeStats(
    commentIds: string[],
    viewerId?: string,
  ): Promise<Map<string, LikeStats>>;
  /**
   * Soft-deletes the comment and every reply under it, at any depth, in one
   * statement (replies stay in the table, so a plain soft delete would orphan them).
   */
  softDeleteWithReplies(comment: Comment): Promise<void>;
  /** Persists through `tx` when given (raw errors), else the base `save`. */
  save(comment: Comment, tx?: CommentTransaction): Promise<Comment>;
  runInTransaction<T>(work: (tx: CommentTransaction) => Promise<T>): Promise<T>;
}

export const COMMENT_REPOSITORY = Symbol.for('ICommentRepository');
