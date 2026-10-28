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
 * Result of a successful `POST /auth/login`, `/auth/google` or `/auth/refresh`.
 * The refresh token is not part of the body: auth sets it as the httpOnly
 * `refresh_token` cookie (path `/auth`), so browser code never sees it.
 */
export interface ILoginResponse {
  /** JWT attached as `Authorization: Bearer <token>` on backend requests. */
  accessToken: string;
  user: IAuthUserResponse;
}

/**
 * Result of a successful `POST /users/register`. Registration creates the user
 * but does not issue a session — the caller signs in separately.
 */
export type IRegisterResponse = IAuthUserResponse;
