/**
 * Request body for creating a profile.
 */
export interface ICreateProfileRequest {
  /** Auth-service user id this profile belongs to */
  authUserId: string;
  /** Public handle, e.g. `@john_doe` */
  handle: string;
}

/**
 * Request body for updating a profile (all fields optional / partial update).
 */
export interface IUpdateProfileRequest {
  /** New display name */
  displayName?: string;
  /** New bio, or `null` to clear it */
  bio?: string | null;
  /** New avatar image URL, or `null` to clear it */
  avatarUrl?: string | null;
}

/**
 * Query for searching users by username prefix (starting conversations).
 */
export interface ISearchProfilesQuery {
  /** Username prefix, 2-50 chars */
  q: string;
  /** Max results, 1-20 (default 10) */
  limit?: number;
}
