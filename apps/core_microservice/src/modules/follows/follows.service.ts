import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';
import { FollowRepository } from './infrastructure/repository/follow.repository';
import { Follow } from './domain/entities/follow.entity';
import { UserPrivacyPortKey } from './domain/interfaces/user-privacy.port';
import type { IUserPrivacyPort } from './domain/interfaces/user-privacy.port';
import { FollowStatus } from './domain/enums/follow-status.enum';

@Injectable()
export class FollowsService {
  // injecting our adapter, not a standard TypeORM repo!!
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly followRepository: FollowRepository,
    @Inject(UserPrivacyPortKey)
    private readonly userPrivacyPort: IUserPrivacyPort,
  ) {}

  async follow(followerId: string, followingId: string): Promise<Follow> {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot follow yourself');
    }
    const existing = await this.followRepository.findByFollowerAndFollowing(
      followerId,
      followingId,
    );
    if (existing) {
      return existing; //
    }

    const isPrivate = await this.userPrivacyPort.isUserPrivate(followingId);
    const initialStatus = isPrivate
      ? FollowStatus.PENDING
      : FollowStatus.ACCEPTED;

    const follow = Follow.create({
      followerId,
      followingId,
      status: initialStatus,
    });
    const savedFollow = await this.followRepository.save(follow);
    this.logger.debug('Follow created', {
      props: { followId: savedFollow.id },
    });
    return savedFollow;
  }

  async getPendingRequests(userId: string): Promise<Follow[]> {
    return this.followRepository.findPendingRequests(userId);
  }

  async acceptRequest(userId: string, followerId: string): Promise<Follow> {
    const follow = await this.followRepository.findByFollowerAndFollowing(
      followerId,
      userId,
    );

    if (!follow || follow.status !== FollowStatus.PENDING) {
      throw new NotFoundException('Pending follow request not found.');
    }

    follow.status = FollowStatus.ACCEPTED;
    await this.followRepository.save(follow);
    this.logger.debug('Follow request accepted', {
      props: { followId: follow.id },
    });

    return follow;
  }

  async rejectRequest(userId: string, followerId: string): Promise<void> {
    const follow = await this.followRepository.findByFollowerAndFollowing(
      followerId,
      userId,
    );

    if (!follow || follow.status !== FollowStatus.PENDING) {
      throw new NotFoundException('Pending follow request not found.');
    }

    await this.followRepository.delete(follow);
    this.logger.debug('Follow request rejected', {
      props: { followId: follow.id },
    });
  }

  async getFollowers(userId: string): Promise<Follow[]> {
    const followers = await this.followRepository.findFollowers(userId);
    this.logger.debug('Followers retrieved', {
      props: { userId, count: followers.length },
    });
    return followers;
  }

  async getFollowing(userId: string): Promise<Follow[]> {
    const following = await this.followRepository.findFollowing(userId);
    this.logger.debug('Following retrieved', {
      props: { userId, count: following.length },
    });
    return following;
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    const follow = await this.followRepository.findByFollowerAndFollowing(
      followerId,
      followingId,
    );
    if (follow) {
      await this.followRepository.delete(follow);
      this.logger.debug('Follow removed', { props: { followId: follow.id } });
    }
  }
}
