import { RepositoryPort } from '@repo/shared';
import { Follow } from '../entities/follow.entity';
import { FollowProps } from './follow.props';

export interface IFollowRepository extends RepositoryPort<Follow, FollowProps> {
  findByFollowerAndFollowing(
    followerId: string,
    followingId: string,
  ): Promise<Follow | null>;
  findFollowers(userId: string): Promise<Follow[]>;
  findFollowing(userId: string): Promise<Follow[]>;
}

export const FollowRepositoryKey = Symbol.for('IFollowRepository');
