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

/** `system` follows the OS preference; the others pin a palette. */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'innogram.theme';

/**
 * Inline script for `<head>`: applies a stored explicit theme before first
 * paint so a dark-mode user never sees a light flash during hydration.
 */
export const themeInitScript = `try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`;

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStored(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // localStorage is unavailable during server rendering.
  useEffect(() => {
    setPreferenceState(readStored());
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    const root = document.documentElement;
    try {
      if (next === 'system') {
        delete root.dataset.theme;
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        root.dataset.theme = next;
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
