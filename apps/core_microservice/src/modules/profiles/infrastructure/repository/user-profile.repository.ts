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
    prefix: string,
    limit: number,
    excludeAuthUserId: string,
  ): Promise<UserProfile[]> {
    // lower(username) LIKE lower(:q) || '%' matches the expression index
    // IDX_user_profiles_username_lower (text_pattern_ops) for prefix scans.
    return this.repository
      .createQueryBuilder('p')
      .where("lower(p.username) LIKE (lower(:q) || '%') ESCAPE '\\'", {
        q: escapeLikePattern(prefix),
      })
      .andWhere('p.authUserId != :excludeAuthUserId', { excludeAuthUserId })
      .orderBy('p.username', 'ASC')
      .take(limit)
      .getMany();
  }
}
