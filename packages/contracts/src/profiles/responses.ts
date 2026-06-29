/**
 * Profile resource as returned by the API. Dates are serialized as ISO strings,
 * and internal columns (e.g. `deletedAt`) are intentionally not exposed.
 */
export interface IProfileResponse {
  id: string;
  authUserId: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
