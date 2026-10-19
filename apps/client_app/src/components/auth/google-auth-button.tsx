'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../lib/auth/auth-context';
import { config } from '../../lib/config';
import { Button } from '../ui/button';

import styles from './google-auth-button.module.css';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const PLACEHOLDER_CLIENT_ID = 'your-google-client-id';
/** Google Identity Services accepts button widths between 200 and 400 px. */
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

interface GoogleAuthButtonProps {
  /** Wording of the button; both modes hit `/auth/google`, which auto-registers new users. */
  mode: 'signin' | 'signup';
}

/**
 * "Sign in / Sign up with Google" button backed by Google Identity Services.
 * Uses the `/auth/google` endpoint, which auto-registers first-time Google
 * users, then signs them in.
 *
 * When `GOOGLE_CLIENT_ID` is unset or still the placeholder, renders a disabled
 * button with an explanatory note instead of attempting a doomed request.
 */
export function GoogleAuthButton({ mode }: GoogleAuthButtonProps) {
  const router = useRouter();
  const { loginWithGoogle } = useAuth();
  const buttonSlotRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const isConfigured =
    config.googleClientId !== '' &&
    config.googleClientId !== PLACEHOLDER_CLIENT_ID;
  const label =
    mode === 'signin' ? 'Sign in with Google' : 'Sign up with Google';

  useEffect(() => {
    if (!isConfigured || !buttonSlotRef.current) {
      return;
    }

    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return;
    }

    // Reuse a script tag another instance (or a previous mount) already added.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', renderGoogleButton);
    if (!existing) {
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      script.removeEventListener('load', renderGoogleButton);
    };
  }, [isConfigured]);

  function renderGoogleButton() {
    const googleId = window.google?.accounts?.id;
    const slot = buttonSlotRef.current;
    if (!googleId || !slot) {
      return;
    }

    googleId.initialize({
      client_id: config.googleClientId,
      context: mode,
      callback: (response) => {
        void handleCredential(response);
      },
    });

    googleId.renderButton(slot, {
      theme: 'outline',
      size: 'large',
      text: mode === 'signin' ? 'signin_with' : 'signup_with',
      shape: 'rectangular',
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, slot.clientWidth)),
    });
  }

  async function handleCredential(response: GoogleCredentialResponse) {
    setError(null);
    try {
      await loginWithGoogle(response.credential);
      router.push('/');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to sign in with Google. Please try again.',
      );
    }
  }

  if (!isConfigured) {
    return (
      <div className={styles.google}>
        <Button variant="secondary" size="lg" fullWidth disabled>
          {label}
        </Button>
        <p className={styles.note}>Google sign-in is not configured yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.google}>
      <div ref={buttonSlotRef} className={styles.buttonSlot} />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
