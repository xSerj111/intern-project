import type { IGoogleLoginRequest, ILoginResponse } from '@repo/contracts';

import { authApi } from '../api/client';

/**
 * Authenticate (or auto-register a new user) against the auth service
 * (`POST /auth/google`).
 *
 * Returns the same shape as `login`; persistence is the caller's responsibility
 * (`AuthProvider.loginWithGoogle`).
 */
export function googleLogin(idToken: string): Promise<ILoginResponse> {
  const body: IGoogleLoginRequest = { idToken };
  return authApi<ILoginResponse>('/auth/google', { method: 'POST', body });
}
