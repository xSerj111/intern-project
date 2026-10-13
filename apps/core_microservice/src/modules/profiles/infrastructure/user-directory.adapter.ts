import { Inject, Injectable } from '@nestjs/common';
import type { IChatUser } from '@repo/contracts';

import { UserNotFoundError } from '../domain/errors/user-profile.errors';
import type { IUserDirectoryPort } from '../domain/interfaces/user-directory.port';
import {
  UserProfileRepositoryKey,
  type IUserProfileRepository,
} from '../domain/interfaces/user-profile-repository.port';

/** Resolves chat user snapshots from the profile repository (by `authUserId`). */
@Injectable()
export class UserDirectoryAdapter implements IUserDirectoryPort {
  constructor(
    @Inject(UserProfileRepositoryKey)
    private readonly profiles: IUserProfileRepository,
  ) {}

  public async getUsers(userIds: string[]): Promise<Map<string, IChatUser>> {
    const unique = [...new Set(userIds)];
    const found = await Promise.all(
      unique.map((id) => this.profiles.findByAuthUserId(id)),
    );
    const result = new Map<string, IChatUser>();
    for (const profile of found) {
      if (!profile) continue;
      result.set(profile.authUserId, {
        userId: profile.authUserId,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl ?? null,
      });
    }
    return result;
  }

  public async assertUsersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const users = await this.getUsers(unique);
    const missing = unique.filter((id) => !users.has(id));
    if (missing.length > 0) throw new UserNotFoundError(missing);
  }
}
