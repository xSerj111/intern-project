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

import type { IAuthUserResponse } from '@repo/contracts';

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
  /** Clear the session. */
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

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password);
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

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      accessToken: session?.accessToken ?? null,
      user: session?.user ?? null,
      isSignedIn: session !== null,
      isHydrated,
      login,
      logout,
    }),
    [session, isHydrated, login, logout],
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
