import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, ILike } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Post, PostStatus } from '../../domain/entities/post.entity';
import { PostLike } from '../../domain/entities/post-like.entity';
import type { PostProps } from '../../domain/interfaces/post.props';

@Injectable()
export class PostRepository extends TypeormRepositoryBase<Post, PostProps> {
  public static readonly entity = Post;
  // Joined by default so reads include the post's author profile.
  protected relations: string[] = ['author', 'assets'];

  constructor(
    @InjectRepository(Post)
    repository: Repository<Post>,
  ) {
    super(repository);
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
      relations: { author: true, assets: true },
      order: {
        createdAt: 'DESC',
      },
      skip,
      take: limit,
    });
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
      relations: { author: true, assets: true },
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
  ): Promise<Map<string, { likeCount: number; likedByMe: boolean }>> {
    const stats = new Map<string, { likeCount: number; likedByMe: boolean }>(
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
