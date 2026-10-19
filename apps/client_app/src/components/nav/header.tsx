'use client';

import Link from 'next/link';

import { useAuth } from '../../lib/auth/auth-context';
import { useUnseenCount } from '../../lib/realtime/notification-cache';
import { Logo } from '../brand/logo';

import styles from './header.module.css';
import { NavLinks } from './nav-links';

/**
 * Persistent application header: brand mark, primary navigation, and the
 * sign-in / sign-out affordance. Present on every route via the root layout.
 */
export function Header() {
  const { isSignedIn, isHydrated, user, logout } = useAuth();
  const unseen = useUnseenCount() ?? 0;

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="Innogram home">
          <Logo />
        </Link>

        <NavLinks />

        <div className={styles.actions}>
          {isHydrated && isSignedIn ? (
            <>
              <Link
                href="/notifications"
                className={styles.bell}
                aria-label={
                  unseen > 0
                    ? `Notifications, ${unseen} unseen`
                    : 'Notifications'
                }
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
                {unseen > 0 && (
                  <span className={styles.bellBadge}>
                    {unseen > 99 ? '99+' : unseen}
                  </span>
                )}
              </Link>
              <span className={`muted ${styles.user}`}>{user?.email}</span>
              <button
                type="button"
                className="button button--ghost"
                onClick={logout}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="button button--ghost">
                Sign in
              </Link>
              <Link href="/signup" className="button">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
