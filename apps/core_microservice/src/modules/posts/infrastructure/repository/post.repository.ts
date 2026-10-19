import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, ILike } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Post, PostStatus } from '../../domain/entities/post.entity';
import { PostLike } from '../../domain/entities/post-like.entity';
import type { PostProps } from '../../domain/interfaces/post.props';
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

  async getFeedForAuthors(
    authorIds: string[],
    page: number,
    limit: number,
  ): Promise<[Post[], number]> {
    const skip = (page - 1) * limit;

    return this.repository.findAndCount({
      where: {
        authorId: In(authorIds),
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
