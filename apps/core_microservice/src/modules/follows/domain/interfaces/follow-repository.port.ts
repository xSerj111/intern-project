import { RepositoryPort } from '@repo/shared';
import type { EntityManager } from 'typeorm';
import { Follow } from '../entities/follow.entity';
import { FollowProps } from './follow.props';

export interface FollowPaging {
  offset: number;
  limit: number;
}

export interface IFollowRepository extends RepositoryPort<Follow, FollowProps> {
  findByFollowerAndFollowing(
    followerId: string,
    followingId: string,
  ): Promise<Follow | null>;
  /**
   * Newest first (`createdAt DESC, id DESC`). Returns up to `limit + 1` rows
   * so the caller can tell whether another page exists.
   */
  findFollowers(userId: string, paging: FollowPaging): Promise<Follow[]>;
  findFollowing(userId: string, paging: FollowPaging): Promise<Follow[]>;
  /** Of `userIds`, the ones `viewerId` follows. One query; no query for an empty list. */
  findFollowedAmong(viewerId: string, userIds: string[]): Promise<Set<string>>;
  /** Persists through `tx` when given (raw errors), else the base `save`. */
  save(follow: Follow, tx?: EntityManager): Promise<Follow>;
  runInTransaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T>;
}

export const FollowRepositoryKey = Symbol.for('IFollowRepository');
