import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, type SelectQueryBuilder } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import type { MediaTypeFilter, PostSort } from '@repo/contracts';
import { Post, PostStatus } from '../../domain/entities/post.entity';
import { PostAsset } from '../../domain/entities/post-asset.entity';
import type { PostProps } from '../../domain/interfaces/post.props';

export interface FeedQuery {
  /** Author set to include; omit for the discover feed (all public posts). */
  authorIds?: string[];
  sort: PostSort;
  mediaType?: MediaTypeFilter;
  page: number;
  limit: number;
}

@Injectable()
export class PostRepository extends TypeormRepositoryBase<Post, PostProps> {
  public static readonly entity = Post;
  // Joined by default so reads include the post's author profile and media.
  protected relations: string[] = ['author', 'assets', 'assets.asset'];

  constructor(
    @InjectRepository(Post)
    repository: Repository<Post>,
  ) {
    super(repository);
  }

  /**
   * Paginated feed of published posts. `authorIds` restricts to a following set;
   * omit it for the discover feed. Sorting and the media-type filter are applied
   * in the database so engagement counts never require an N+1 walk.
   */
  async getFeed(query: FeedQuery): Promise<[Post[], number]> {
    const { authorIds, sort, mediaType, page, limit } = query;
    const skip = (page - 1) * limit;

    const qb = this.repository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('post.assets', 'assets')
      .leftJoinAndSelect('assets.asset', 'asset')
      .where('post.status = :status', { status: PostStatus.Published });

    if (authorIds) {
      qb.andWhere('post.authorId IN (:...authorIds)', { authorIds });
    }

    this.applyMediaTypeFilter(qb, mediaType);
    this.applySort(qb, sort);

    return qb.skip(skip).take(limit).getManyAndCount();
  }

  /**
   * Replace a post's media wholesale: delete existing `post_assets` rows and
   * insert the new ordered set. Used by the edit flow (FR-008).
   */
  async replaceAssets(postId: string, assetIds: string[]): Promise<void> {
    await this.repository.manager.delete(PostAsset, { postId });

    if (assetIds.length === 0) return;

    const rows = assetIds.map((assetId, index) => {
      const attachment = new PostAsset();
      attachment.postId = postId;
      attachment.assetId = assetId;
      attachment.displayOrder = index;
      return attachment;
    });

    await this.repository.manager.save(PostAsset, rows);
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

  private applySort(qb: SelectQueryBuilder<Post>, sort: PostSort): void {
    if (sort === 'oldest') {
      qb.orderBy('post.createdAt', 'ASC');
      return;
    }

    if (sort === 'most_liked') {
      qb.addSelect(
        `(SELECT COUNT(*) FROM "post_likes" pl WHERE pl."postId" = post."id" AND pl."deletedAt" IS NULL)`,
        'like_count',
      )
        .orderBy('like_count', 'DESC')
        .addOrderBy('post.createdAt', 'DESC');
      return;
    }

    qb.orderBy('post.createdAt', 'DESC');
  }

  private applyMediaTypeFilter(
    qb: SelectQueryBuilder<Post>,
    mediaType?: MediaTypeFilter,
  ): void {
    if (!mediaType) return;

    if (mediaType === 'text') {
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM "post_assets" pa WHERE pa."postId" = post."id")`,
      );
      return;
    }

    const prefix = mediaType === 'photos' ? 'image/%' : 'video/%';
    qb.andWhere(
      `EXISTS (SELECT 1 FROM "post_assets" pa JOIN "assets" a ON a."id" = pa."assetId" WHERE pa."postId" = post."id" AND a."mimeType" LIKE :mimePrefix)`,
      { mimePrefix: prefix },
    );
  }
}
