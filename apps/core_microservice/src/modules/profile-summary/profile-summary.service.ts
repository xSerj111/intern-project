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
import {
  ProfileSummaryCache,
  type CachedCounts,
  type CachedProfile,
} from '../../common/cache/profile-summary-cache';
import { UserProfile } from '../profiles/domain/entities/user-profile.entity';
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
    private readonly cache: ProfileSummaryCache,
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
    // Callers (OptionalJwtAuthGuard, UUID pipe) have already run: no cache
    // read happens before them (FR-020).
    const [cachedProfile, cachedCounts] = await Promise.all([
      this.readProfile(authUserId),
      this.readCounts(authUserId),
    ]);

    // A miss loads from the DB; a missing profile throws 404 before any count query.
    const profile = cachedProfile ?? (await this.loadProfile(authUserId));

    const [counts, isFollowedByMe] = await Promise.all([
      cachedCounts ?? this.loadCounts(authUserId),
      // Viewer-specific: computed on every request, never cached.
      viewerId && viewerId !== authUserId
        ? this.follows.exists({
            followerId: viewerId,
            followingId: authUserId,
          })
        : Promise.resolve(false),
    ]);
    const { followerCount, followingCount, postCount } = counts;

    this.logger.debug('Profile summary retrieved', {
      props: { authUserId, followerCount, followingCount, postCount },
    });

    return {
      profile,
      stats: { followerCount, followingCount, postCount, isFollowedByMe },
    };
  }

  private async readProfile(authUserId: string): Promise<UserProfile | null> {
    try {
      const cached = await this.cache.getProfile(authUserId);
      return cached ? hydrateProfile(cached) : null;
    } catch (error) {
      this.logCacheError('read profile', authUserId, error);
      return null;
    }
  }

  private async readCounts(authUserId: string): Promise<CachedCounts | null> {
    try {
      return await this.cache.getCounts(authUserId);
    } catch (error) {
      this.logCacheError('read counts', authUserId, error);
      return null;
    }
  }

  private async loadProfile(authUserId: string): Promise<UserProfile> {
    const profile = await this.profiles.getProfileByAuthUserId(authUserId);
    try {
      await this.cache.setProfile({
        ...profile,
        bio: profile.bio ?? null,
        avatarUrl: profile.avatarUrl ?? null,
      });
    } catch (error) {
      this.logCacheError('write profile', authUserId, error);
    }
    return profile;
  }

  private async loadCounts(authUserId: string): Promise<CachedCounts> {
    const [followerCount, followingCount, postCount] = await Promise.all([
      this.follows.count({ followingId: authUserId }),
      this.follows.count({ followerId: authUserId }),
      this.posts.countPublishedByAuthor(authUserId),
    ]);
    const counts = { followerCount, followingCount, postCount };
    try {
      await this.cache.setCounts(authUserId, counts);
    } catch (error) {
      this.logCacheError('write counts', authUserId, error);
    }
    return counts;
  }

  private logCacheError(op: string, authUserId: string, error: unknown): void {
    this.logger.warn(`Profile summary cache: failed to ${op}`, {
      props: {
        authUserId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * Rebuilds the entity shape `ProfileResponseDto` reads from a JSON-decoded
 * cache value, so a hit serializes exactly like a miss (dates as ISO strings).
 */
function hydrateProfile(cached: CachedProfile): UserProfile | null {
  const createdAt = new Date(cached.createdAt);
  const updatedAt = new Date(cached.updatedAt);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) {
    return null; // corrupt entry: treat as a miss
  }
  return Object.assign(new UserProfile(), {
    id: cached.id,
    authUserId: cached.authUserId,
    username: cached.username,
    displayName: cached.displayName,
    bio: cached.bio,
    avatarUrl: cached.avatarUrl,
    createdAt,
    updatedAt,
  });
}
