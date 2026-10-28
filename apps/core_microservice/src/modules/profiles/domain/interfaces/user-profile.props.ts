/**
 * Domain props for a user profile — the persisted columns, independent of
 * TypeORM. The entity `implements UserProfileProps`, and the repository port is
 * typed against it so query params are checked against real fields.
 */
export interface UserProfileProps {
  authUserId: string;
  username: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
}
