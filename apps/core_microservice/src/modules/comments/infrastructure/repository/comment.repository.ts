import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Comment } from '../../domain/entities/comment.entity';
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

  /** Batch comment counts keyed by post id (non-deleted only). */
  async countByPostIds(postIds: string[]): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();

    const rows = await this.repository
      .createQueryBuilder('comment')
      .select('comment.postId', 'postId')
      .addSelect('COUNT(*)', 'count')
      .where('comment.postId IN (:...postIds)', { postIds })
      .groupBy('comment.postId')
      .getRawMany<{ postId: string; count: string }>();

    return new Map(rows.map((row) => [row.postId, Number(row.count)]));
  }
}
