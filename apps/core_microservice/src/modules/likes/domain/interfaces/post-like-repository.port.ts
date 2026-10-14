import type { EntityManager } from 'typeorm';

export interface IPostLikeRepository {
  /**
   * Upserts the like through the caller's transaction. `inserted` is true only
   * for a brand-new row: re-liking an active like or restoring a soft-deleted
   * one reports false.
   */
  like(
    postId: string,
    userId: string,
    tx: EntityManager,
  ): Promise<{ inserted: boolean }>;
  /** Soft-deletes an active like. Returns false when there was none. */
  unlike(postId: string, userId: string, tx?: EntityManager): Promise<boolean>;
  /** Active likes (`deletedAt IS NULL`). */
  count(postId: string): Promise<number>;
  /** Runs `work` in one transaction; pass its handle to `like` and the outbox. */
  runInTransaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T>;
  likedBy(postId: string, userId: string): Promise<boolean>;
}

export const POST_LIKE_REPOSITORY = Symbol('IPostLikeRepository');
