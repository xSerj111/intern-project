'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { IAuthUserResponse, ILoginResponse } from '@repo/contracts';

import { googleLogin } from './google';
import { login as loginRequest } from './login';
import { refresh as refreshRequest } from './refresh';

const STORAGE_KEY = 'innogram.session';

/** Seconds before expiry at which we proactively refresh. */
const REFRESH_SKEW_MS = 30_000;

/** Decode a JWT's `exp` into ms-since-epoch, or `null` when unknown. */
function tokenExpiresAt(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const text = decodeURIComponent(
      Array.from(json, (c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`).join(''),
    );
    const decoded = JSON.parse(text) as { exp?: number };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Signed-in session persisted client-side (research.md §6). */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
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
  /** Exchange the refresh token for a fresh access token. */
  refreshSession: () => Promise<boolean>;
  /** Clear the session. */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const establishSession = useCallback((result: ILoginResponse) => {
    const nextSession: AuthSession = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  // Re-hydrate the persisted session after mount (localStorage is not available
  // during server rendering). If the stored access token has expired (or is
  // about to), refresh it before treating the user as signed in.
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as AuthSession;
        const expiresAt = tokenExpiresAt(stored.accessToken);
        if (expiresAt !== null && expiresAt - Date.now() <= REFRESH_SKEW_MS) {
          refreshRequest(stored.refreshToken)
            .then((result) => {
              if (!cancelled) establishSession(result);
            })
            .catch(() => {
              if (!cancelled) window.localStorage.removeItem(STORAGE_KEY);
            })
            .finally(() => {
              if (!cancelled) setIsHydrated(true);
            });
          return;
        }
        setSession(stored);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setIsHydrated(true);
    return () => {
      cancelled = true;
    };
  }, [establishSession]);

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

  const refreshSession = useCallback(async (): Promise<boolean> => {
    if (!session?.refreshToken) return false;
    try {
      establishSession(await refreshRequest(session.refreshToken));
      return true;
    } catch {
      logout();
      return false;
    }
  }, [session, establishSession, logout]);

  // Proactively refresh shortly before the access token expires so an open
  // tab never holds an expired token.
  useEffect(() => {
    if (!session?.accessToken) return;
    const expiresAt = tokenExpiresAt(session.accessToken);
    if (expiresAt === null) return;
    const delay = Math.max(0, expiresAt - Date.now() - REFRESH_SKEW_MS);
    const id = setTimeout(() => {
      void refreshSession();
    }, delay);
    return () => clearTimeout(id);
  }, [session?.accessToken, refreshSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      accessToken: session?.accessToken ?? null,
      user: session?.user ?? null,
      isSignedIn: session !== null,
      isHydrated,
      login,
      loginWithGoogle,
      refreshSession,
      logout,
    }),
    [session, isHydrated, login, loginWithGoogle, refreshSession, logout],
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
