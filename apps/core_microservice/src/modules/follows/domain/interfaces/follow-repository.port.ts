import { RepositoryPort } from '@repo/shared';
import type { EntityManager } from 'typeorm';
import { Follow } from '../entities/follow.entity';
import { FollowProps } from './follow.props';

export interface IFollowRepository extends RepositoryPort<Follow, FollowProps> {
  findByFollowerAndFollowing(
    followerId: string,
    followingId: string,
  ): Promise<Follow | null>;
  findFollowers(userId: string): Promise<Follow[]>;
  findFollowing(userId: string): Promise<Follow[]>;
  /** Persists through `tx` when given (raw errors), else the base `save`. */
  save(follow: Follow, tx?: EntityManager): Promise<Follow>;
  runInTransaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T>;
}

export const FollowRepositoryKey = Symbol.for('IFollowRepository');
