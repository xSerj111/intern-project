'use client';

import Link from 'next/link';

import { useAuth } from '../../lib/auth/auth-context';
import { Logo } from '../brand/logo';

import styles from './header.module.css';
import { NavLinks } from './nav-links';

/**
 * Persistent application header: brand mark, primary navigation, and the
 * sign-in / sign-out affordance. Present on every route via the root layout.
 */
export function Header() {
  const { isSignedIn, isHydrated, user, logout } = useAuth();

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
