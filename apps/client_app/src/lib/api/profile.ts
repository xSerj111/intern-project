import type { IProfileResponse } from '@repo/contracts';

import { coreApi } from './client';

/**
 * Fetch the signed-in user's own profile (`GET /profiles/me`). The core service
 * resolves the profile from the JWT `sub`, so no id is needed on the client.
 */
export function getMyProfile(
  token: string | null,
  signal?: AbortSignal,
): Promise<IProfileResponse> {
  return coreApi<IProfileResponse>('/profiles/me', { token, signal });
}
