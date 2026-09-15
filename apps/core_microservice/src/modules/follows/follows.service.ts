import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';
import { FollowRepository } from './infrastructure/repository/follow.repository';
import { Follow } from './domain/entities/follow.entity';
import {
  UserPrivacyPortKey,
  type IUserPrivacyPort,
} from './domain/interfaces/user-privacy.port';
import {
  UserProfilePortKey,
  type IUserProfilePort,
  type UserProfileDto,
} from './domain/interfaces/user-profile.port';
import { FollowStatus } from './domain/enums/follow-status.enum';
import { FollowUserResponseDto } from './dto/follow-user-response.dto';

import { UserFollowedEvent } from '@repo/shared';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class FollowsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly followRepository: FollowRepository,
    @Inject(UserPrivacyPortKey)
    private readonly userPrivacyPort: IUserPrivacyPort,
    @Inject(UserProfilePortKey)
    private readonly userProfilePort: IUserProfilePort,
    @Inject('NOTIFICATIONS_SERVICE')
    private readonly client: ClientProxy,
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
      return existing;
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

    if (initialStatus === FollowStatus.ACCEPTED) {
      this.client.emit(
        'user.followed',
        new UserFollowedEvent(followerId, followingId),
      );
    }

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

    this.client.emit(
      'user.followed',
      new UserFollowedEvent(followerId, userId),
    );

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

  async getFollowersList(
    requesterId: string,
    targetUserId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FollowUserResponseDto[]; totalCount: number }> {
    const isProfilePrivate =
      await this.userPrivacyPort.isUserPrivate(targetUserId);

    if (isProfilePrivate && requesterId !== targetUserId) {
      const followRelation =
        await this.followRepository.findByFollowerAndFollowing(
          requesterId,
          targetUserId,
        );
      if (followRelation?.status !== FollowStatus.ACCEPTED) {
        throw new ForbiddenException(
          'This profile is private. You must follow this user to see their followers.',
        );
      }
    }

    const [follows, totalCount] = await this.followRepository.getFollowers(
      targetUserId,
      limit,
      offset,
    );

    if (follows.length === 0) {
      return { items: [], totalCount: 0 };
    }

    const followerIds = follows.map((f) => f.followerId);
    const profiles = await this.userProfilePort.getProfilesByIds(followerIds);

    // Slownik umozliwiajacy szybki odczyt profili
    const profilesMap = new Map<string, UserProfileDto>();
    profiles.forEach((p) => profilesMap.set(p.id, p));

    const items = follows.map((follow) => {
      // Zabezpieczenie przed brakiem profilu (np. jesli usunieto uzytkownika z pominieciem procedur bazy)
      const profile = profilesMap.get(follow.followerId) || {
        id: follow.followerId,
        username: 'Unknown User',
      };
      return new FollowUserResponseDto(follow, profile, true);
    });

    return { items, totalCount };
  }

  async getFollowingList(
    requesterId: string,
    targetUserId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FollowUserResponseDto[]; totalCount: number }> {
    const isProfilePrivate =
      await this.userPrivacyPort.isUserPrivate(targetUserId);

    if (isProfilePrivate && requesterId !== targetUserId) {
      const followRelation =
        await this.followRepository.findByFollowerAndFollowing(
          requesterId,
          targetUserId,
        );
      if (followRelation?.status !== FollowStatus.ACCEPTED) {
        throw new ForbiddenException(
          'This profile is private. You must follow this user to see who they are following.',
        );
      }
    }

    const [follows, totalCount] = await this.followRepository.getFollowing(
      targetUserId,
      limit,
      offset,
    );

    if (follows.length === 0) {
      return { items: [], totalCount: 0 };
    }

    const followingIds = follows.map((f) => f.followingId);
    const profiles = await this.userProfilePort.getProfilesByIds(followingIds);

    const profilesMap = new Map<string, UserProfileDto>();
    profiles.forEach((p) => profilesMap.set(p.id, p));

    const items = follows.map((follow) => {
      const profile = profilesMap.get(follow.followingId) || {
        id: follow.followingId,
        username: 'Unknown User',
      };
      return new FollowUserResponseDto(follow, profile, false);
    });

    return { items, totalCount };
  }
}
