import type { ILoginRequest, ILoginResponse } from '@repo/contracts';

import { authApi } from '../api/client';

/**
 * Authenticate against the auth service (`POST /auth/login`).
 *
 * Returns the wire response; persistence is the caller's responsibility
 * (`AuthProvider.login`).
 */
export function login(
  email: string,
  password: string,
): Promise<ILoginResponse> {
  const body: ILoginRequest = { email, password };
  return authApi<ILoginResponse>('/auth/login', { method: 'POST', body });
}
