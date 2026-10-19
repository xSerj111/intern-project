import type { ILoginResponse } from '@repo/contracts';

import { ApiError, authApi } from '../api/client';

/** Access/refresh token pair held for the signed-in user. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Token change pushed to subscribers: the refreshed `POST /auth/refresh` response,
 * or `null` when the refresh was rejected and the user must be signed out.
 */
export type TokenChange = ILoginResponse | null;

export type TokenListener = (change: TokenChange) => void;

// Module-level store so `apiRequest` (outside React) can read and renew tokens;
// `AuthProvider` keeps it in sync with the persisted session.
let currentTokens: AuthTokens | null = null;
let inFlight: Promise<string> | null = null;
const listeners = new Set<TokenListener>();

/** Replace the stored tokens without notifying subscribers (login, hydrate, logout). */
export function setAuthTokens(tokens: AuthTokens | null): void {
  currentTokens = tokens;
}

/** The current access token, or `null` when signed out. */
export function getAccessToken(): string | null {
  return currentTokens?.accessToken ?? null;
}

/** Listen for refreshed tokens and forced sign-outs. Returns the unsubscribe function. */
export function subscribeTokens(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(change: TokenChange): void {
  for (const listener of listeners) {
    listener(change);
  }
}

/** True when the auth service rejected the refresh token itself (not a transient failure). */
function isRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

async function performRefresh(): Promise<string> {
  const refreshToken = currentTokens?.refreshToken;
  if (!refreshToken) {
    currentTokens = null;
    notify(null);
    throw new ApiError('Not signed in', 401);
  }

  try {
    const result = await authApi<ILoginResponse>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });
    currentTokens = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
    notify(result);
    return result.accessToken;
  } catch (error) {
    // A rejected refresh token ends the session; a network blip or 5xx keeps it so
    // the next request can try again.
    if (isRejection(error)) {
      currentTokens = null;
      notify(null);
    }
    throw error;
  }
}

/**
 * Exchange the stored refresh token for a new pair (`POST /auth/refresh`).
 *
 * Concurrent callers share one in-flight request, so a burst of 401s triggers a
 * single refresh. Resolves with the new access token.
 */
export function refreshTokens(): Promise<string> {
  if (!inFlight) {
    inFlight = performRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
