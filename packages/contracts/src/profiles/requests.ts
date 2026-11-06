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
  /**
   * Id of a public asset the requester uploaded via `POST /assets/upload`,
   * or `null` to clear the avatar. The server resolves it to a URL.
   */
  avatarAssetId?: string | null;
}

/**
 * Query for searching users by any part of the username or display name
 * (starting conversations).
 */
export interface ISearchProfilesQuery {
  /** Text matched anywhere in the username or display name, 2-50 chars */
  q: string;
  /** Max results, 1-50 (default 10) */
  limit?: number;
}
