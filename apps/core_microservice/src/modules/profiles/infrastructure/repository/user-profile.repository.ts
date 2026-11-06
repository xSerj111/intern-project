import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { escapeLikePattern } from '../../../../common/db/like-pattern';
import { UserProfile } from '../../domain/entities/user-profile.entity';
import type { UserProfileProps } from '../../domain/interfaces/user-profile.props';
import type { IUserProfileRepository } from '../../domain/interfaces/user-profile-repository.port';

/**
 * TypeORM adapter for the profile repository port. Inherits the full data-access
 * surface (find/save/softDelete/paginate/...) from {@link TypeormRepositoryBase}
 * and adds profile-specific finders.
 */
@Injectable()
export class UserProfileRepository
  extends TypeormRepositoryBase<UserProfile, UserProfileProps>
  implements IUserProfileRepository
{
  public static readonly entity = UserProfile;
  protected relations: string[] = [];

  constructor(
    @InjectRepository(UserProfile)
    repository: Repository<UserProfile>,
  ) {
    super(repository);
  }

  public async findByAuthUserId(
    authUserId: string,
  ): Promise<UserProfile | null> {
    return this.repository.findOne({ where: { authUserId } });
  }

  public async findByAuthUserIds(
    authUserIds: string[],
  ): Promise<UserProfile[]> {
    if (authUserIds.length === 0) return [];
    return this.repository.find({ where: { authUserId: In(authUserIds) } });
  }

  public async searchByUsername(
    query: string,
    limit: number,
    excludeAuthUserId: string,
  ): Promise<UserProfile[]> {
    // The infix LIKEs on lower(username) / lower("displayName") are served by the
    // GIN trigram indexes IDX_user_profiles_username_trgm and
    // IDX_user_profiles_display_name_trgm. Known limit: a 2-char query has no
    // full trigram, so the index can't narrow it (fine at current volume; raise
    // the minimum to 3 or add a prefix-only path if perf runs show a problem).
    // Ranking: exact username, then username prefix, then best trigram
    // similarity of username or display name, then username.
    return this.repository
      .createQueryBuilder('p')
      .where(
        "(lower(p.username) LIKE '%' || lower(:q) || '%' ESCAPE '\\' OR lower(p.\"displayName\") LIKE '%' || lower(:q) || '%' ESCAPE '\\')",
        { q: escapeLikePattern(query) },
      )
      .andWhere('p.authUserId != :excludeAuthUserId', { excludeAuthUserId })
      .setParameter('raw', query)
      .orderBy('lower(p.username) = lower(:raw)', 'DESC')
      .addOrderBy("lower(p.username) LIKE lower(:q) || '%' ESCAPE '\\'", 'DESC')
      .addOrderBy(
        'greatest(similarity(lower(p.username), lower(:raw)), similarity(lower(coalesce(p."displayName", \'\')), lower(:raw)))',
        'DESC',
      )
      .addOrderBy('p.username', 'ASC')
      .take(limit)
      .getMany();
  }
}
