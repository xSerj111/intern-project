import type { RepositoryPort } from '@repo/shared';
import type { UserProfile } from '../../domain/entities/user-profile.entity';
import type { UserProfileProps } from './user-profile.props';

/**
 * Profile data-access port: the generic repository contract plus the
 * profile-specific finders. The service depends on this abstraction; the
 * TypeORM `UserProfileRepository` is the adapter.
 */
export interface IUserProfileRepository extends RepositoryPort<
  UserProfile,
  UserProfileProps
> {
  findByAuthUserId(authUserId: string): Promise<UserProfile | null>;
  /** Single `IN` lookup; missing ids are simply absent from the result. */
  findByAuthUserIds(authUserIds: string[]): Promise<UserProfile[]>;
  /** Case-insensitive username prefix match; deleted profiles and `excludeAuthUserId` left out. */
  searchByUsername(
    prefix: string,
    limit: number,
    excludeAuthUserId: string,
  ): Promise<UserProfile[]>;
}

/** DI token, for when the service should depend on the interface, not the class. */
export const UserProfileRepositoryKey = Symbol.for('IUserProfileRepository');
