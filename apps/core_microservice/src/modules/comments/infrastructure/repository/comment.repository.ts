import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Comment } from '../../domain/entities/comment.entity';
import { CommentLike } from '../../domain/entities/comment-like.entity';
import type { CommentProps } from '../../domain/interfaces/comment.props';

@Injectable()
export class CommentRepository extends TypeormRepositoryBase<
  Comment,
  CommentProps
> {
  public static readonly entity = Comment;
  protected relations: string[] = ['author'];

  constructor(
    @InjectRepository(Comment)
    repository: Repository<Comment>,
  ) {
    super(repository);
  }

  /** Comments for a post, newest first, with the author profile joined. */
  async findByPost(postId: string): Promise<Comment[]> {
    return this.repository.find({
      where: { postId },
      relations: { author: true },
      order: { createdAt: 'DESC' },
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
  ): Promise<Map<string, { likeCount: number; likedByMe: boolean }>> {
    const stats = new Map<string, { likeCount: number; likedByMe: boolean }>(
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
