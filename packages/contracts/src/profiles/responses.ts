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

/**
 * Profile with social stats, as returned by `GET /profiles/by-user/:userId`.
 */
export interface IProfileSummaryResponse extends IProfileResponse {
  followerCount: number;
  followingCount: number;
  /** Published posts only. */
  postCount: number;
  /** `false` for the requester's own profile. */
  isFollowedByMe: boolean;
}
