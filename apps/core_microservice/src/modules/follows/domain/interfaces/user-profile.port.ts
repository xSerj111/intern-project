export const UserProfilePortKey = Symbol.for('IUserProfilePort');

export interface UserProfileDto {
  id: string;
  username: string;
  avatarUrl?: string | null;
}

export interface IUserProfilePort {
  getProfilesByIds(userIds: string[]): Promise<UserProfileDto[]>;
}
