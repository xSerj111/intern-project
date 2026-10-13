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

import { authApi } from '../api/client';
import { googleLogin } from './google';
import { login as loginRequest } from './login';

const STORAGE_KEY = 'innogram.session';

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
  /** Revoke the tokens on the server (best effort) and clear the session. */
  logout: () => void;
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
        setSession(JSON.parse(raw) as AuthSession);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setIsHydrated(true);
  }, []);

  const establishSession = useCallback((result: ILoginResponse) => {
    const nextSession: AuthSession = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
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
    // Revoke both tokens server-side; local state is cleared whatever the call returns.
    if (session) {
      authApi('/auth/logout', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
        token: session.accessToken,
      }).catch(() => undefined);
    }
    window.localStorage.removeItem(STORAGE_KEY);
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
