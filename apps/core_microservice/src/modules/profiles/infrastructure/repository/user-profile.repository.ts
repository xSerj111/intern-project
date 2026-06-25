import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
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
}
