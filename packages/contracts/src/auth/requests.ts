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
