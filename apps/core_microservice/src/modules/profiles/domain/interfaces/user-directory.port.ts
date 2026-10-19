import type { IChatUser } from '@repo/contracts';

/**
 * Read-only user lookup for other modules (chats). Keyed by auth user id
 * (JWT `sub`), returns the profile snapshot used on the wire.
 */
export interface IUserDirectoryPort {
  /** Unknown ids are simply absent from the returned map. */
  getUsers(userIds: string[]): Promise<Map<string, IChatUser>>;
  /** @throws UserNotFoundError listing the ids that have no profile. */
  assertUsersExist(userIds: string[]): Promise<void>;
}

export const USER_DIRECTORY_PORT = Symbol.for('IUserDirectoryPort');
