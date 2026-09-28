import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { PostLike } from '../../domain/entities/post-like.entity';
import type { PostLikeProps } from '../../domain/interfaces/post-like.props';

/**
 * Persistence adapter for post likes over the existing `post_likes` table.
 * The unique `(postId, userId)` index plus soft-delete makes like/unlike
 * idempotent: re-liking restores the soft-deleted row instead of inserting.
 */
@Injectable()
export class PostLikeRepository extends TypeormRepositoryBase<
  PostLike,
  PostLikeProps
> {
  public static readonly entity = PostLike;
  protected relations: string[] = [];

  constructor(
    @InjectRepository(PostLike)
    repository: Repository<PostLike>,
  ) {
    super(repository);
  }

  /** Idempotently like a post (restores a previously soft-deleted like). */
  async like(postId: string, userId: string): Promise<PostLike> {
    const existing = await this.repository.findOne({
      where: { postId, userId },
      withDeleted: true,
    });

    if (existing) {
      if (existing.deletedAt) {
        await this.repository.restore(existing.id);
        existing.deletedAt = undefined as unknown as Date;
      }
      return existing;
    }

    return this.repository.save(PostLike.create(postId, userId));
  }

  /** Idempotently remove a like (no-op when none exists). */
  async unlike(postId: string, userId: string): Promise<void> {
    const existing = await this.repository.findOne({
      where: { postId, userId },
    });
    if (existing) {
      await this.repository.softRemove(existing);
    }
  }

  /** The caller's active like of a post, if any. */
  async findByPostAndUser(
    postId: string,
    userId: string,
  ): Promise<PostLike | null> {
    return this.repository.findOne({ where: { postId, userId } });
  }

  /** Whether the caller has an active like on the post. */
  async existsByPostAndUser(postId: string, userId: string): Promise<boolean> {
    return (await this.repository.count({ where: { postId, userId } })) > 0;
  }

  /** Batch like counts keyed by post id (non-deleted only). */
  async countByPostIds(postIds: string[]): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();

    const rows = await this.repository
      .createQueryBuilder('like')
      .select('like.postId', 'postId')
      .addSelect('COUNT(*)', 'count')
      .where('like.postId IN (:...postIds)', { postIds })
      .groupBy('like.postId')
      .getRawMany<{ postId: string; count: string }>();

    return new Map(rows.map((row) => [row.postId, Number(row.count)]));
  }

  /** The subset of `postIds` the caller has liked (non-deleted only). */
  async findLikedPostIds(
    userId: string,
    postIds: string[],
  ): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();

    const rows = await this.repository.find({
      where: { userId, postId: In(postIds) },
      select: { postId: true },
    });

    return new Set(rows.map((row) => row.postId));
  }
}
