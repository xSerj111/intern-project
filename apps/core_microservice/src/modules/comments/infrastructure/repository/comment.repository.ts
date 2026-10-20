import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, type EntityManager, type Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Comment } from '../../domain/entities/comment.entity';
import { CommentLike } from '../../domain/entities/comment-like.entity';
import type { CommentProps } from '../../domain/interfaces/comment.props';
import type { ICommentRepository } from '../../domain/interfaces/comment-repository.port';
import type { LikeStats } from '../../../posts/domain/interfaces/post-repository.port';

@Injectable()
export class CommentRepository
  extends TypeormRepositoryBase<Comment, CommentProps>
  implements ICommentRepository
{
  public static readonly entity = Comment;
  protected relations: string[] = ['author'];

  constructor(
    @InjectRepository(Comment)
    repository: Repository<Comment>,
  ) {
    super(repository);
  }

  /**
   * Inside a transaction the raw TypeORM error propagates so the caller's
   * transaction wrapper maps it; outside, the base `save` maps it.
   */
  override async save(comment: Comment, tx?: EntityManager): Promise<Comment> {
    if (!tx) return super.save(comment);
    return tx.getRepository(Comment).save(comment);
  }

  async runInTransaction<T>(
    work: (tx: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.repository.manager.transaction(work);
  }

  async softDeleteWithReplies(comment: Comment): Promise<void> {
    await this.repository.query(
      `WITH RECURSIVE thread AS (
         SELECT id FROM comments WHERE id = $1
         UNION
         SELECT c.id FROM comments c JOIN thread t ON c."parentId" = t.id
       )
       UPDATE comments SET "deletedAt" = now()
       WHERE id IN (SELECT id FROM thread) AND "deletedAt" IS NULL`,
      [comment.id],
    );
    this.logger.debug(`[Comment] soft deleted ${comment.id} and its replies`);
  }

  /**
   * Root comments of a post, newest first; fetches `limit + 1` so the caller
   * can tell whether another page exists. Soft-deleted rows are excluded by
   * the entity's `deletedAt` column.
   */
  async findRootPage(
    postId: string,
    { offset, limit }: { offset: number; limit: number },
  ): Promise<Comment[]> {
    return this.repository.find({
      where: { postId, parentId: IsNull() },
      relations: { author: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: offset,
      take: limit + 1,
    });
  }

  /**
   * All live descendants of the given roots, at any depth (replies to replies
   * are allowed by `Comment.create`). The recursive walk stops at a
   * soft-deleted comment, and the final load excludes soft-deleted rows.
   */
  async findRepliesOf(rootIds: string[]): Promise<Comment[]> {
    if (rootIds.length === 0) return [];
    const rows = await this.repository.query<{ id: string }[]>(
      `WITH RECURSIVE thread AS (
         SELECT id FROM comments WHERE "parentId" = ANY($1::uuid[]) AND "deletedAt" IS NULL
         UNION
         SELECT c.id FROM comments c JOIN thread t ON c."parentId" = t.id
         WHERE c."deletedAt" IS NULL
       )
       SELECT id FROM thread`,
      [rootIds],
    );
    if (rows.length === 0) return [];
    return this.repository.find({
      where: { id: In(rows.map((row) => row.id)) },
      relations: { author: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Like count and the viewer's own like for each comment, in one grouped
   * query over active likes (`deletedAt IS NULL`). Every requested id gets an
   * entry; `viewerId` is undefined for anonymous requests (`likedByMe: false`).
   */
  async getLikeStats(
    commentIds: string[],
    viewerId?: string,
  ): Promise<Map<string, LikeStats>> {
    const stats = new Map<string, LikeStats>(
      commentIds.map((id) => [id, { likeCount: 0, likedByMe: false }]),
    );
    if (commentIds.length === 0) return stats;

    const query = this.repository.manager
      .createQueryBuilder(CommentLike, 'l')
      .select('l."commentId"', 'commentId')
      .addSelect('COUNT(*)::int', 'likeCount')
      .where('l."commentId" IN (:...commentIds)', { commentIds })
      .andWhere('l."deletedAt" IS NULL')
      .groupBy('l."commentId"');
    if (viewerId) {
      query
        .addSelect('BOOL_OR(l."userId" = :viewerId)', 'likedByMe')
        .setParameter('viewerId', viewerId);
    }

    const rows = await query.getRawMany<{
      commentId: string;
      likeCount: number;
      likedByMe?: boolean;
    }>();
    for (const row of rows) {
      stats.set(row.commentId, {
        likeCount: Number(row.likeCount),
        likedByMe: row.likedByMe === true,
      });
    }
    return stats;
  }
}
