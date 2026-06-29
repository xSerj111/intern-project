import { Injectable } from '@nestjs/common';
import { FollowRepository } from './infrastructure/repository/follow.repository';
import { Follow } from './domain/entities/follow.entity';

@Injectable()
export class FollowsService {
  // injecting our adapter, not a standard TypeORM repo!!
  constructor(private readonly followRepository: FollowRepository) {}

  async follow(followerId: string, followingId: string): Promise<Follow> {
    const existing = await this.followRepository.findByFollowerAndFollowing(followerId, followingId);
    if (existing) {
      return existing; // 
    }

    const follow = Follow.create({ followerId, followingId });
    return this.followRepository.save(follow);
  }

  async getFollowers(userId: string): Promise<Follow[]> {
    return this.followRepository.findFollowers(userId);
  }

  async getFollowing(userId: string): Promise<Follow[]> {
    return this.followRepository.findFollowing(userId);
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    const follow = await this.followRepository.findByFollowerAndFollowing(followerId, followingId);
    if (follow) {
      await this.followRepository.delete(follow);
    }
  }
}
