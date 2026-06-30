import { Inject, Injectable } from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';
import { FollowRepository } from './infrastructure/repository/follow.repository';
import { Follow } from './domain/entities/follow.entity';

@Injectable()
export class FollowsService {
  // injecting our adapter, not a standard TypeORM repo!!
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly followRepository: FollowRepository,
  ) {}

  async follow(followerId: string, followingId: string): Promise<Follow> {
    const existing = await this.followRepository.findByFollowerAndFollowing(followerId, followingId);
    if (existing) {
      return existing; // 
    }

    const follow = Follow.create({ followerId, followingId });
    const savedFollow = await this.followRepository.save(follow);
    this.logger.debug('Follow created', { props: { followId: savedFollow.id } });
    return savedFollow;
  }

  async getFollowers(userId: string): Promise<Follow[]> {
    const followers = await this.followRepository.findFollowers(userId);
    this.logger.debug('Followers retrieved', { props: { userId, count: followers.length } });
    return followers;
  }

  async getFollowing(userId: string): Promise<Follow[]> {
    const following = await this.followRepository.findFollowing(userId);
    this.logger.debug('Following retrieved', { props: { userId, count: following.length } });
    return following;
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    const follow = await this.followRepository.findByFollowerAndFollowing(followerId, followingId);
    if (follow) {
      await this.followRepository.delete(follow);
      this.logger.debug('Follow removed', { props: { followId: follow.id } });
    }
  }
}
