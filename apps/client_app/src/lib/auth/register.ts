import type { IRegisterRequest, IRegisterResponse } from '@repo/contracts';

import { authApi } from '../api/client';

/**
 * Register a new account against the auth service (`POST /users/register`).
 *
 * Registration creates the user but does not issue a session — the caller must
 * sign in separately afterwards.
 */
export function register(
  email: string,
  password: string,
): Promise<IRegisterResponse> {
  const body: IRegisterRequest = { email, password };
  return authApi<IRegisterResponse>('/users/register', {
    method: 'POST',
    body,
  });
}
