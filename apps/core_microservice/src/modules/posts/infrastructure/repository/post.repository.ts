import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, ILike } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Post, PostStatus } from '../../domain/entities/post.entity';
import { PostLike } from '../../domain/entities/post-like.entity';
import type { PostProps } from '../../domain/interfaces/post.props';
import { FeedCursor } from '../../domain/feed-cursor';
import type {
  IPostRepository,
  LikeStats,
} from '../../domain/interfaces/post-repository.port';

@Injectable()
export class PostRepository
  extends TypeormRepositoryBase<Post, PostProps>
  implements IPostRepository
{
  public static readonly entity = Post;
  // Joined by default so reads include the post's author profile.
  protected relations: string[] = ['author', 'assets', 'assets.asset'];

  constructor(
    @InjectRepository(Post)
    repository: Repository<Post>,
  ) {
    super(repository);
  }

  async findById(id: string): Promise<Post | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Ids first (index-only on the partial feed index, follows as a sub-select,
   * no COUNT), then one hydration query by id. `t` is the raw Postgres
   * timestamp text with microseconds, so the cursor never loses precision.
   */
  async findFeedPage(
    viewerId: string,
    cursor: FeedCursor | null,
    limit: number,
  ): Promise<{ posts: Post[]; nextCursor: string | null }> {
    const params: unknown[] = [viewerId, limit + 1];
    let keyset = '';
    if (cursor) {
      params.push(cursor.t, cursor.id);
      keyset = 'AND (p."createdAt", p.id) < ($3::timestamptz, $4::uuid)';
    }
    // The status literal stays inline so the planner can match the partial index.
    const rows = await this.repository.query<{ id: string; t: string }[]>(
      `SELECT p.id,
              to_char(p."createdAt" AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t
         FROM posts p
        WHERE p.status = '${PostStatus.Published}'
          AND p."deletedAt" IS NULL
          AND (p."authorId" = $1
               OR p."authorId" IN (SELECT f."followingId" FROM follows f
                                    WHERE f."followerId" = $1
                                      AND f."deletedAt" IS NULL))
          ${keyset}
        ORDER BY p."createdAt" DESC, p.id DESC
        LIMIT $2`,
      params,
    );

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? FeedCursor.fromRow(last).encode() : null;
    if (page.length === 0) return { posts: [], nextCursor };

    const ids = page.map((row) => row.id);
    const found = await this.repository.find({
      where: { id: In(ids) },
      relations: { author: true, assets: { asset: true } },
    });
    const byId = new Map(found.map((post) => [post.id, post]));
    // A post deleted between the two queries simply drops out of the page.
    const posts = ids
      .map((id) => byId.get(id))
      .filter((post): post is Post => post !== undefined);
    return { posts, nextCursor };
  }

  async findByAuthor(
    authorId: string,
    status: PostStatus,
    page: number,
    limit: number,
  ): Promise<[Post[], number]> {
    return this.repository.findAndCount({
      where: { authorId, status },
      relations: { author: true, assets: { asset: true } },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async countPublishedByAuthor(authorId: string): Promise<number> {
    return this.repository.count({
      where: { authorId, status: PostStatus.Published },
    });
  }

  /**
   * Active comment count per post in one grouped query. Every requested id
   * gets an entry; the join condition skips soft-deleted comments.
   */
  async getCommentCounts(postIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(postIds.map((id) => [id, 0]));
    if (postIds.length === 0) return counts;

    const rows = await this.repository
      .createQueryBuilder('p')
      .select('p.id', 'postId')
      .addSelect('COUNT(c.id)::int', 'commentCount')
      .leftJoin('p.comments', 'c', 'c."deletedAt" IS NULL')
      .where('p.id IN (:...postIds)', { postIds })
      .groupBy('p.id')
      .getRawMany<{ postId: string; commentCount: number }>();
    for (const row of rows) {
      counts.set(row.postId, Number(row.commentCount));
    }
    return counts;
  }

  async searchPublishedPosts(
    keyword: string,
    page: number,
    limit: number,
  ): Promise<[Post[], number]> {
    const skip = (page - 1) * limit;

    return this.repository.findAndCount({
      where: {
        content: ILike(`%${keyword}%`),
        status: PostStatus.Published,
      },
      relations: { author: true, assets: { asset: true } },
      order: {
        createdAt: 'DESC',
      },
      skip,
      take: limit,
    });
  }

  /**
   * Like count and the viewer's own like for each post, in one grouped
   * query over active likes (`deletedAt IS NULL`). Every requested id gets an
   * entry; `viewerId` is undefined for anonymous requests (`likedByMe: false`).
   */
  async getLikeStats(
    postIds: string[],
    viewerId?: string,
  ): Promise<Map<string, LikeStats>> {
    const stats = new Map<string, LikeStats>(
      postIds.map((id) => [id, { likeCount: 0, likedByMe: false }]),
    );
    if (postIds.length === 0) return stats;

    const query = this.repository.manager
      .createQueryBuilder(PostLike, 'l')
      .select('l."postId"', 'postId')
      .addSelect('COUNT(*)::int', 'likeCount')
      .where('l."postId" IN (:...postIds)', { postIds })
      .andWhere('l."deletedAt" IS NULL')
      .groupBy('l."postId"');
    if (viewerId) {
      query
        .addSelect('BOOL_OR(l."userId" = :viewerId)', 'likedByMe')
        .setParameter('viewerId', viewerId);
    }

    const rows = await query.getRawMany<{
      postId: string;
      likeCount: number;
      likedByMe?: boolean;
    }>();
    for (const row of rows) {
      stats.set(row.postId, {
        likeCount: Number(row.likeCount),
        likedByMe: row.likedByMe === true,
      });
    }
    return stats;
  }
}
