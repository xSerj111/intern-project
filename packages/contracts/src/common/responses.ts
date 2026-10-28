/**
 * Default pagination constants shared by API and clients.
 */
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

/**
 * Generic paginated response envelope. Use for every list endpoint:
 *
 * @example
 * export interface IProfileListResponse
 *   extends IPaginatedResponse<IProfileResponse> {}
 */
export interface IPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Pagination metadata without the data array.
 */
export interface IPaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Minimal public identity of a user, embedded in posts, comments and chats.
 * `userId` is the auth user id (JWT `sub`).
 */
export interface IUserSummary {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}
