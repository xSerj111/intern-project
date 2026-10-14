import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type EntityManager, type Repository } from 'typeorm';

import { CommentLike } from '../../../comments/domain/entities/comment-like.entity';
import type { ICommentLikeRepository } from '../../domain/interfaces/comment-like-repository.port';

@Injectable()
export class CommentLikeRepository implements ICommentLikeRepository {
  constructor(
    @InjectRepository(CommentLike)
    private readonly repository: Repository<CommentLike>,
  ) {}

  async like(
    commentId: string,
    userId: string,
    tx: EntityManager,
  ): Promise<{ inserted: boolean }> {
    // `xmax = 0` is true only for a freshly inserted tuple; the DO UPDATE path
    // (restore) leaves a non-zero xmax. The WHERE makes liking an already
    // active like a no-op that returns no row.
    const rows: { inserted: boolean }[] = await tx.query(
      `INSERT INTO "comment_likes" ("commentId", "userId")
       VALUES ($1, $2)
       ON CONFLICT ("commentId", "userId")
       DO UPDATE SET "deletedAt" = NULL WHERE "comment_likes"."deletedAt" IS NOT NULL
       RETURNING (xmax = 0) AS inserted`,
      [commentId, userId],
    );
    return { inserted: rows[0]?.inserted === true };
  }

  async unlike(
    commentId: string,
    userId: string,
    tx?: EntityManager,
  ): Promise<boolean> {
    const manager = tx ?? this.repository.manager;
    const result = await manager.update(
      CommentLike,
      { commentId, userId, deletedAt: IsNull() },
      { deletedAt: () => 'now()' },
    );
    return (result.affected ?? 0) > 0;
  }

  async count(commentId: string): Promise<number> {
    return this.repository.count({ where: { commentId, deletedAt: IsNull() } });
  }

  async likedBy(commentId: string, userId: string): Promise<boolean> {
    return this.repository.exists({
      where: { commentId, userId, deletedAt: IsNull() },
    });
  }
}
