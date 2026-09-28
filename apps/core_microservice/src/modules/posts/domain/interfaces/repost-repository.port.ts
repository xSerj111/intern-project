import type { RepositoryPort } from '@repo/shared';
import type { Repost } from '../entities/repost.entity';

/** Domain props for a repost — used to type the repository's query params. */
export interface RepostProps {
  originalPostId: string;
  authorId: string;
}

export interface IRepostRepository extends RepositoryPort<Repost, RepostProps> {
  /** The caller's active (non-deleted) repost of a post, if any. */
  findByOriginalAndAuthor(
    originalPostId: string,
    authorId: string,
  ): Promise<Repost | null>;

  /** All active reposts created by an author, newest first. */
  findByAuthor(authorId: string): Promise<Repost[]>;

  /** Batch repost counts keyed by original post id (non-deleted only). */
  countByOriginalPostIds(postIds: string[]): Promise<Map<string, number>>;
}

export const RepostRepositoryKey = Symbol.for('IRepostRepository');
