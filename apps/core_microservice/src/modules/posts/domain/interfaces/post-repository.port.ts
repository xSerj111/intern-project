import type { RepositoryPort } from '@repo/shared';
import type { Post, PostStatus } from '../entities/post.entity';
import type { PostProps } from './post.props';
import type { FeedCursor } from '../feed-cursor';

/** Like count and whether the viewer has an active like on the item. */
export interface LikeStats {
  likeCount: number;
  likedByMe: boolean;
}

export interface IPostRepository extends RepositoryPort<Post, PostProps> {
  /** The post by id without relations; null when missing or soft-deleted. */
  findById(id: string): Promise<Post | null>;
  /**
   * One keyset page of the viewer's feed: published posts by the viewer and
   * the users they follow, ordered `createdAt DESC, id DESC`, strictly after
   * `cursor` (first page when null). Posts carry author and assets (with
   * each asset's file). `nextCursor` is null when this is the last page.
   */
  findFeedPage(
    viewerId: string,
    cursor: FeedCursor | null,
    limit: number,
  ): Promise<{ posts: Post[]; nextCursor: string | null }>;
  /** Published posts whose content contains the keyword (case-insensitive). */
  searchPublishedPosts(
    keyword: string,
    page: number,
    limit: number,
  ): Promise<[Post[], number]>;
  /** One author's posts in the given status, newest first, with author and assets. */
  findByAuthor(
    authorId: string,
    status: PostStatus,
    page: number,
    limit: number,
  ): Promise<[Post[], number]>;
  /** Number of the author's published posts. */
  countPublishedByAuthor(authorId: string): Promise<number>;
  /**
   * Active comments (`deletedAt IS NULL`, replies included) per post, in one
   * grouped query. Every requested id gets an entry (0 when none).
   */
  getCommentCounts(postIds: string[]): Promise<Map<string, number>>;
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
