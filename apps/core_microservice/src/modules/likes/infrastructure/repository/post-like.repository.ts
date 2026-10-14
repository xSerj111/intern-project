import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type EntityManager, type Repository } from 'typeorm';

import { PostLike } from '../../../posts/domain/entities/post-like.entity';
import type { IPostLikeRepository } from '../../domain/interfaces/post-like-repository.port';

@Injectable()
export class PostLikeRepository implements IPostLikeRepository {
  constructor(
    @InjectRepository(PostLike)
    private readonly repository: Repository<PostLike>,
  ) {}

  async like(
    postId: string,
    userId: string,
    tx: EntityManager,
  ): Promise<{ inserted: boolean }> {
    // `xmax = 0` is true only for a freshly inserted tuple; the DO UPDATE path
    // (restore) leaves a non-zero xmax. The WHERE makes liking an already
    // active like a no-op that returns no row.
    const rows: { inserted: boolean }[] = await tx.query(
      `INSERT INTO "post_likes" ("postId", "userId")
       VALUES ($1, $2)
       ON CONFLICT ("postId", "userId")
       DO UPDATE SET "deletedAt" = NULL WHERE "post_likes"."deletedAt" IS NOT NULL
       RETURNING (xmax = 0) AS inserted`,
      [postId, userId],
    );
    return { inserted: rows[0]?.inserted === true };
  }

  async unlike(
    postId: string,
    userId: string,
    tx?: EntityManager,
  ): Promise<boolean> {
    const manager = tx ?? this.repository.manager;
    const result = await manager.update(
      PostLike,
      { postId, userId, deletedAt: IsNull() },
      { deletedAt: () => 'now()' },
    );
    return (result.affected ?? 0) > 0;
  }

  async count(postId: string): Promise<number> {
    return this.repository.count({ where: { postId, deletedAt: IsNull() } });
  }

  async likedBy(postId: string, userId: string): Promise<boolean> {
    return this.repository.exists({
      where: { postId, userId, deletedAt: IsNull() },
    });
  }

  async runInTransaction<T>(
    work: (tx: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.repository.manager.transaction(work);
  }
}
