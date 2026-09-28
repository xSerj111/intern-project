import type { ILoginResponse, IRefreshRequest } from '@repo/contracts';

import { authApi } from '../api/client';

/**
 * Exchange an opaque refresh token for a fresh access token (`POST /auth/refresh`).
 * Returns the same shape as `login`; persistence is the caller's responsibility.
 */
export function refresh(refreshToken: string): Promise<ILoginResponse> {
  const body: IRefreshRequest = { refreshToken };
  return authApi<ILoginResponse>('/auth/refresh', { method: 'POST', body });
}
