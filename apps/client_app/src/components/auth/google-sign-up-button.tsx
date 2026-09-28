'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../lib/auth/auth-context';
import { config } from '../../lib/config';

import styles from './google-sign-up-button.module.css';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const PLACEHOLDER_CLIENT_ID = 'your-google-client-id';

/**
 * "Sign up with Google" button backed by Google Identity Services. Uses the
 * `/auth/google` endpoint, which auto-registers first-time Google users, then
 * signs them in.
 *
 * When `GOOGLE_CLIENT_ID` is unset or still the placeholder, renders a disabled
 * button with an explanatory note instead of attempting a doomed request.
 */
export function GoogleSignUpButton() {
  const router = useRouter();
  const { loginWithGoogle } = useAuth();
  const buttonSlotRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const isConfigured =
    config.googleClientId !== '' && config.googleClientId !== PLACEHOLDER_CLIENT_ID;

  useEffect(() => {
    if (!isConfigured || !buttonSlotRef.current) {
      return;
    }

    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    document.head.appendChild(script);

    return () => {
      script.onload = null;
    };
  }, [isConfigured]);

  function renderGoogleButton() {
    const googleId = window.google?.accounts?.id;
    if (!googleId || !buttonSlotRef.current) {
      return;
    }

    googleId.initialize({
      client_id: config.googleClientId,
      context: 'signup',
      callback: (response) => {
        void handleCredential(response);
      },
    });

    googleId.renderButton(buttonSlotRef.current, {
      theme: 'outline',
      size: 'large',
      text: 'signup_with',
      shape: 'rectangular',
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
        <button type="button" className="button button--ghost" disabled>
          Sign up with Google
        </button>
        <p className={`muted ${styles.note}`}>
          Google sign-up is not configured yet.
        </p>
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
