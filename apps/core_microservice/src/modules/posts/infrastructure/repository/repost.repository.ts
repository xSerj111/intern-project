import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Repost } from '../../domain/entities/repost.entity';
import type {
  IRepostRepository,
  RepostProps,
} from '../../domain/interfaces/repost-repository.port';

/**
 * Persistence adapter for reposts. Idempotent create (restores a previously
 * soft-deleted repost) and idempotent delete back the feed "re-post" action.
 */
@Injectable()
export class RepostRepository
  extends TypeormRepositoryBase<Repost, RepostProps>
  implements IRepostRepository
{
  public static readonly entity = Repost;
  protected relations: string[] = [];

  constructor(
    @InjectRepository(Repost)
    repository: Repository<Repost>,
  ) {
    super(repository);
  }

  async findByOriginalAndAuthor(
    originalPostId: string,
    authorId: string,
  ): Promise<Repost | null> {
    return this.repository.findOne({ where: { originalPostId, authorId } });
  }

  async findByAuthor(authorId: string): Promise<Repost[]> {
    return this.repository.find({
      where: { authorId },
      order: { createdAt: 'DESC' },
    });
  }

  async countByOriginalPostIds(
    postIds: string[],
  ): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();

    const rows = await this.repository
      .createQueryBuilder('repost')
      .select('repost.originalPostId', 'postId')
      .addSelect('COUNT(*)', 'count')
      .where('repost.originalPostId IN (:...postIds)', { postIds })
      .groupBy('repost.originalPostId')
      .getRawMany<{ postId: string; count: string }>();

    return new Map(rows.map((row) => [row.postId, Number(row.count)]));
  }

  /** Idempotently re-post a post (restores a previously soft-deleted repost). */
  async repost(originalPostId: string, authorId: string): Promise<Repost> {
    const existing = await this.repository.findOne({
      where: { originalPostId, authorId },
      withDeleted: true,
    });

    if (existing) {
      if (existing.deletedAt) {
        await this.repository.restore(existing.id);
        existing.deletedAt = undefined as unknown as Date;
      }
      return existing;
    }

    return this.repository.save(Repost.create(originalPostId, authorId));
  }

  /** Idempotently remove the caller's re-post (no-op when none exists). */
  async unrepost(originalPostId: string, authorId: string): Promise<void> {
    const existing = await this.repository.findOne({
      where: { originalPostId, authorId },
    });
    if (existing) {
      await this.repository.softRemove(existing);
    }
  }

  /**
   * Feed page of reposts, newest first. `authorIds` restricts to the given
   * re-posters (following feed); omit for the discover feed. The original post
   * (with its author and media) is joined so it can be embedded; a soft-deleted
   * original resolves to `null` ("post unavailable").
   */
  async findFeed(params: {
    authorIds?: string[];
    page: number;
    limit: number;
  }): Promise<[Repost[], number]> {
    const skip = (params.page - 1) * params.limit;

    return this.repository.findAndCount({
      where: params.authorIds ? { authorId: In(params.authorIds) } : {},
      relations: {
        originalPost: {
          author: true,
          assets: { asset: true },
        },
      },
      order: { createdAt: 'DESC' },
      skip,
      take: params.limit,
    });
  }
}
