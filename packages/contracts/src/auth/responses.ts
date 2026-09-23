/**
 * Authenticated user as returned by the auth service. Dates are serialized as
 * ISO strings and the password hash is never exposed.
 */
export interface IAuthUserResponse {
  /** Auth user id — equals the JWT `sub`. */
  id: string;
  email: string;
  isEmailVerified: boolean;
  /** Optional roles for future RBAC; may be absent. */
  roles?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of a successful `POST /auth/login`.
 */
export interface ILoginResponse {
  /** JWT attached as `Authorization: Bearer <token>` on backend requests. */
  accessToken: string;
  /** Opaque refresh token; stored but not exercised in the baseline. */
  refreshToken: string;
  user: IAuthUserResponse;
}
