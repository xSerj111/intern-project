import { Inject, Injectable } from '@nestjs/common';
import {
  type ActorSnapshot,
  DatabaseQueryError,
  DomainError,
  LoggerKey,
  type Logger,
  PostgresErrorCode,
  RoutingKeys,
  UniqueConstraintViolationError,
  type UserFollowedPayload,
  isTypeOrmError,
} from '@repo/shared';
import type { EntityManager } from 'typeorm';
import {
  OUTBOX_PORT,
  type IOutboxPort,
} from '../../common/messaging/outbox.port';
import {
  USER_DIRECTORY_PORT,
  type IUserDirectoryPort,
} from '../profiles/domain/interfaces/user-directory.port';
import {
  FollowRepositoryKey,
  type IFollowRepository,
} from './domain/interfaces/follow-repository.port';
import { Follow } from './domain/entities/follow.entity';

@Injectable()
export class FollowsService {
  // injecting our adapter, not a standard TypeORM repo!!
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(FollowRepositoryKey)
    private readonly followRepository: IFollowRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: IOutboxPort,
    @Inject(USER_DIRECTORY_PORT)
    private readonly userDirectory: IUserDirectoryPort,
  ) {}

  async follow(followerId: string, followingId: string): Promise<Follow> {
    const existing = await this.followRepository.findByFollowerAndFollowing(
      followerId,
      followingId,
    );
    if (existing) {
      return existing;
    }

    const follow = Follow.create({ followerId, followingId });
    const actor = follow.notifiesFollowed()
      ? await this.loadActor(followerId)
      : null;

    // The outbox row shares the follow's transaction: both commit or neither.
    const savedFollow = await this.runInTransaction(async (tx) => {
      const saved = await this.followRepository.save(follow, tx);
      if (actor) {
        const payload: UserFollowedPayload = {
          actor,
          recipientId: saved.followingId,
        };
        await this.outbox.add(RoutingKeys.USER_FOLLOWED, payload, tx);
      }
      return saved;
    });
    this.logger.debug('Follow created', {
      props: { followId: savedFollow.id },
    });
    return savedFollow;
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

  /** Snapshot of the acting user for the event; null (event skipped) if they have no profile. */
  private async loadActor(userId: string): Promise<ActorSnapshot | null> {
    const users = await this.userDirectory.getUsers([userId]);
    const user = users.get(userId);
    if (!user) {
      this.logger.warn('Skipping notification: actor has no profile', {
        props: { userId },
      });
      return null;
    }
    return { ...user };
  }

  private async runInTransaction<T>(
    work: (tx: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.followRepository.runInTransaction(work);
    } catch (err: unknown) {
      if (err instanceof DomainError) throw err;
      if (
        isTypeOrmError(err) &&
        err.driverError?.code === PostgresErrorCode.UniqueViolation
      ) {
        throw new UniqueConstraintViolationError(
          'follows',
          err.driverError.detail ?? '',
        );
      }
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new DatabaseQueryError();
    }
  }
}
