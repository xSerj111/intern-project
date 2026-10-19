import { Inject, Injectable } from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';
import {
  FollowRepositoryKey,
  type IFollowRepository,
} from '../follows/domain/interfaces/follow-repository.port';
import {
  POST_REPOSITORY,
  type IPostRepository,
} from '../posts/domain/interfaces/post-repository.port';
import type { UserProfile } from '../profiles/domain/entities/user-profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import type { ProfileStats } from './dto/profile-summary-response.dto';

/**
 * Read model for a profile page: the profile plus follow and post counters.
 * Lives in its own module because it needs profiles, follows and posts, and
 * follows/posts already depend on profiles (importing them back would cycle).
 */
@Injectable()
export class ProfileSummaryService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly profiles: ProfilesService,
    @Inject(FollowRepositoryKey)
    private readonly follows: IFollowRepository,
    @Inject(POST_REPOSITORY) private readonly posts: IPostRepository,
  ) {}

  /**
   * @param authUserId whose profile to show (the JWT `sub` of that user)
   * @param viewerId the requester, if signed in
   * @throws EntityNotFoundError (404) when the user has no profile
   */
  async getSummary(
    authUserId: string,
    viewerId?: string,
  ): Promise<{ profile: UserProfile; stats: ProfileStats }> {
    const profile = await this.profiles.getProfileByAuthUserId(authUserId);

    const [followerCount, followingCount, postCount, isFollowedByMe] =
      await Promise.all([
        this.follows.count({ followingId: authUserId }),
        this.follows.count({ followerId: authUserId }),
        this.posts.countPublishedByAuthor(authUserId),
        viewerId && viewerId !== authUserId
          ? this.follows.exists({
              followerId: viewerId,
              followingId: authUserId,
            })
          : Promise.resolve(false),
      ]);

    this.logger.debug('Profile summary retrieved', {
      props: { authUserId, followerCount, followingCount, postCount },
    });

    return {
      profile,
      stats: { followerCount, followingCount, postCount, isFollowedByMe },
    };
  }
}
