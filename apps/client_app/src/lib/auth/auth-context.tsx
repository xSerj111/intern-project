'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { IAuthUserResponse, ILoginResponse } from '@repo/contracts';

import { authApi } from '../api/client';
import { googleLogin } from './google';
import { login as loginRequest } from './login';
import {
  getAccessToken,
  setAuthTokens,
  subscribeTokens,
  type TokenListener,
} from './refresh';

const STORAGE_KEY = 'innogram.session';

/**
 * Signed-in session persisted client-side (research.md §6). The refresh token is
 * not part of it: the auth service keeps it in an httpOnly cookie.
 */
export interface AuthSession {
  accessToken: string;
  user: IAuthUserResponse;
}

interface AuthContextValue {
  /** Full session, or `null` when signed out. */
  session: AuthSession | null;
  /** Convenience accessor for the current JWT. */
  accessToken: string | null;
  /** The signed-in user (JWT `sub` is `user.id`). */
  user: IAuthUserResponse | null;
  /** True when signed in. */
  isSignedIn: boolean;
  /** False until the stored session has been read from `localStorage`. */
  isHydrated: boolean;
  /** Authenticate against the auth service and persist the session. */
  login: (email: string, password: string) => Promise<void>;
  /** Authenticate with Google and persist the session (auto-registers users). */
  loginWithGoogle: (idToken: string) => Promise<void>;
  /** Revoke the tokens on the server (best effort) and clear the session. */
  logout: () => void;
  /** Latest access token, including one refreshed outside React (read at call time). */
  getAccessToken: () => string | null;
  /** Listen for token refreshes and forced sign-outs; returns the unsubscribe function. */
  subscribeTokens: (listener: TokenListener) => () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Re-hydrate the persisted session after mount (localStorage is not available
  // during server rendering).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const { accessToken, user } = JSON.parse(raw) as AuthSession;
        const stored: AuthSession = { accessToken, user };
        // Rewrite so a refresh token persisted by older builds doesn't linger.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        setAuthTokens(stored);
        setSession(stored);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setIsHydrated(true);
  }, []);

  // Persist tokens refreshed by `refreshTokens()`, and sign out when it fails.
  useEffect(
    () =>
      subscribeTokens((change) => {
        if (!change) {
          window.localStorage.removeItem(STORAGE_KEY);
          setSession(null);
          return;
        }
        setSession((previous) => {
          const nextSession: AuthSession = {
            accessToken: change.accessToken,
            user: change.user ?? previous?.user,
          };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
          return nextSession;
        });
      }),
    [],
  );

  const establishSession = useCallback((result: ILoginResponse) => {
    const nextSession: AuthSession = {
      accessToken: result.accessToken,
      user: result.user,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setAuthTokens(nextSession);
    setSession(nextSession);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      establishSession(await loginRequest(email, password));
    },
    [establishSession],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      establishSession(await googleLogin(idToken));
    },
    [establishSession],
  );

  const logout = useCallback(() => {
    // Revoke both tokens server-side (the refresh token rides in its httpOnly cookie,
    // which the response clears); local state is cleared whatever the call returns.
    if (session) {
      authApi('/auth/logout', {
        method: 'POST',
        token: session.accessToken,
      }).catch(() => undefined);
    }
    window.localStorage.removeItem(STORAGE_KEY);
    setAuthTokens(null);
    setSession(null);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      accessToken: session?.accessToken ?? null,
      user: session?.user ?? null,
      isSignedIn: session !== null,
      isHydrated,
      login,
      loginWithGoogle,
      logout,
      getAccessToken,
      subscribeTokens,
    }),
    [session, isHydrated, login, loginWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Subscribe to token refreshes and forced sign-outs for the component's lifetime.
 * The latest `listener` is always called, so it need not be memoized.
 */
export function useTokenSubscription(listener: TokenListener): void {
  const listenerRef = useRef(listener);
  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => subscribeTokens((change) => listenerRef.current(change)), []);
}
