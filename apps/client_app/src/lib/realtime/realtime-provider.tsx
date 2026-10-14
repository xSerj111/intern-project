'use client';

import {
  REALTIME_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@repo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/auth-context';
import {
  getAccessToken,
  refreshTokens,
  subscribeTokens,
} from '../auth/refresh';
import { config } from '../config';
import { registerChatCacheHandlers } from './chat-cache';
import { registerNotificationCacheHandlers } from './notification-cache';

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RealtimeContextValue {
  /** The live socket while signed in, or `null` when signed out. */
  socket: RealtimeSocket | null;
  /** True while the socket is connected to the `/realtime` namespace. */
  isConnected: boolean;
}

export const RealtimeContext = createContext<RealtimeContextValue>({
  socket: null,
  isConnected: false,
});

/** Refresh-and-reconnect attempts allowed before signing out (contract: one). */
const MAX_AUTH_RECOVERIES = 1;
/** A connection that stays up this long resets the auth-recovery budget. */
const STABLE_CONNECTION_MS = 30_000;
/** Retries after a transient failure (`unavailable`, refresh network error / 5xx). */
const MAX_TRANSIENT_RETRIES = 5;
const TRANSIENT_RETRY_BASE_MS = 1000;
const TRANSIENT_RETRY_MAX_MS = 30_000;
/** Built-in transport reconnects (network drops) before giving up until `online`. */
const MAX_TRANSPORT_RECONNECTS = 10;
const AUTH_RENEW_TIMEOUT_MS = 5000;

/** True when the auth service rejected the refresh token (the session is gone). */
function isRefreshRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/**
 * Owns the Socket.IO connection to core's `/realtime` namespace (research.md §15).
 *
 * Connects once signed in and sends the latest access token through the `auth`
 * callback on every (re)connect. A rejected handshake or an expired session is
 * recovered by one token refresh; a second failure signs out. Transient failures
 * retry with capped exponential backoff and a bounded count, so nothing spins
 * forever. Every token refresh is pushed to the live socket with `auth:renew`.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [socket, setSocket] = useState<RealtimeSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // `logout` changes identity with the session; read the latest one from a ref so
  // the socket is not torn down on every token refresh.
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let disposed = false;
    let authRecoveries = 0;
    let transientRetries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;

    const next: RealtimeSocket = io(
      `${config.coreServiceUrl}${REALTIME_NAMESPACE}`,
      {
        auth: (cb) => cb({ token: getAccessToken() }),
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnectionAttempts: MAX_TRANSPORT_RECONNECTS,
        reconnectionDelayMax: 10_000,
      },
    );

    // Socket events keep the chat caches live; every (re)connect catches up.
    const unregisterChatCache = registerChatCacheHandlers(next, queryClient, {
      userId,
    });
    const unregisterNotificationCache = registerNotificationCacheHandlers(
      next,
      queryClient,
    );

    const signOut = () => {
      if (!disposed) {
        logoutRef.current();
      }
    };

    const scheduleTransientRetry = (action: () => void) => {
      if (disposed || transientRetries >= MAX_TRANSIENT_RETRIES) {
        return;
      }
      const delay = Math.min(
        TRANSIENT_RETRY_BASE_MS * 2 ** transientRetries,
        TRANSIENT_RETRY_MAX_MS,
      );
      transientRetries += 1;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(action, delay);
    };

    /** Refresh the access token once, then reconnect; sign out when the budget is spent. */
    const refreshAndReconnect = () => {
      if (disposed) {
        return;
      }
      if (authRecoveries >= MAX_AUTH_RECOVERIES) {
        signOut();
        return;
      }
      authRecoveries += 1;
      next.disconnect();
      refreshTokens()
        .then(() => {
          if (!disposed) {
            next.connect();
          }
        })
        .catch((error: unknown) => {
          // A rejected refresh already cleared the session via `subscribeTokens`
          // (this effect is torn down); a network error / 5xx keeps it, so retry.
          if (!isRefreshRejection(error)) {
            authRecoveries -= 1;
            scheduleTransientRetry(refreshAndReconnect);
          }
        });
    };

    next.on('connect', () => {
      setIsConnected(true);
      transientRetries = 0;
      clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        authRecoveries = 0;
      }, STABLE_CONNECTION_MS);
    });

    next.on('disconnect', () => {
      setIsConnected(false);
      clearTimeout(stableTimer);
    });

    next.on('connect_error', (error) => {
      // `socket.active` stays true for transport errors, which the built-in
      // reconnection (bounded by `reconnectionAttempts`) handles itself.
      if (next.active) {
        return;
      }
      if (error.message === 'unauthorized') {
        refreshAndReconnect();
      } else {
        // 'unavailable' (core fails closed when Redis is down) or anything else.
        scheduleTransientRetry(() => next.connect());
      }
    });

    next.on('session:expired', ({ reason }) => {
      if (reason === 'revoked') {
        signOut();
        return;
      }
      refreshAndReconnect();
    });

    // After every token refresh, hand the new token to the live connection.
    const unsubscribeTokens = subscribeTokens((change) => {
      if (!change || !next.connected) {
        return;
      }
      next
        .timeout(AUTH_RENEW_TIMEOUT_MS)
        .emit('auth:renew', { token: change.accessToken }, (err, res) => {
          // A timeout leaves recovery to the normal reconnect path; an explicit
          // rejection means the server is dropping us, so reconnect with the
          // fresh token (bounded by the same budget).
          if (!err && !res.ok) {
            if (authRecoveries >= MAX_AUTH_RECOVERIES) {
              signOut();
              return;
            }
            authRecoveries += 1;
            next.disconnect().connect();
          }
        });
    });

    // Built-in reconnects are bounded; resume once the browser is back online.
    const handleOnline = () => {
      if (!disposed && !next.connected) {
        transientRetries = 0;
        next.connect();
      }
    };
    window.addEventListener('online', handleOnline);

    setSocket(next);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(stableTimer);
      window.removeEventListener('online', handleOnline);
      unsubscribeTokens();
      unregisterChatCache();
      unregisterNotificationCache();
      next.removeAllListeners();
      next.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, [userId, queryClient]);

  const value = useMemo<RealtimeContextValue>(
    () => ({ socket, isConnected }),
    [socket, isConnected],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
