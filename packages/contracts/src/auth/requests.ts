/**
 * Request body for `POST /auth/login`.
 *
 * Validation mirrors `LoginDto`: `email` must be a valid email address and
 * `password` must be at least 8 characters long.
 */
export interface ILoginRequest {
  /** Account email address. */
  email: string;
  /** Account password (min length 8). */
  password: string;
}

/**
 * Request body for `POST /users/register`.
 *
 * Validation mirrors `CreateUserDto`: `email` must be a valid email address and
 * `password` must be at least 8 characters long. The DTO's `handle` field is
 * ignored by the service (it derives a default handle from the email), so the
 * client only sends these two fields.
 */
export interface IRegisterRequest {
  /** Desired account email address. */
  email: string;
  /** Desired account password (min length 8). */
  password: string;
}

/**
 * Request body for `POST /auth/google`.
 *
 * The Google ID token issued by Google Identity Services. Used for both
 * sign-in and (auto-)registration of new users.
 */
export interface IGoogleLoginRequest {
  /** Google-issued ID token JWT. */
  idToken: string;
}
