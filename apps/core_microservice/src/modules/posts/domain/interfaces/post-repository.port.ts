import type { RepositoryPort } from '@repo/shared';
import type { Post } from '../entities/post.entity';
import type { PostProps } from './post.props';

/** Like count and whether the viewer has an active like on the item. */
export interface LikeStats {
  likeCount: number;
  likedByMe: boolean;
}

export interface IPostRepository extends RepositoryPort<Post, PostProps> {
  /** The post by id without relations; null when missing or soft-deleted. */
  findById(id: string): Promise<Post | null>;
  /** Published posts of the given authors, newest first, with author and assets. */
  getFeedForAuthors(
    authorIds: string[],
    page: number,
    limit: number,
  ): Promise<[Post[], number]>;
  /** Published posts whose content contains the keyword (case-insensitive). */
  searchPublishedPosts(
    keyword: string,
    page: number,
    limit: number,
  ): Promise<[Post[], number]>;
  /**
   * Like stats for each requested post (every id gets an entry); `viewerId`
   * is undefined for anonymous requests (`likedByMe: false`).
   */
  getLikeStats(
    postIds: string[],
    viewerId?: string,
  ): Promise<Map<string, LikeStats>>;
}

export const POST_REPOSITORY = Symbol.for('IPostRepository');
