'use client';

import {
  Bell,
  ChevronRight,
  LogOut,
  Palette,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { useAuth } from '../../../../lib/auth/auth-context';
import { cx } from '../../../../lib/cx';

import styles from './settings-shell.module.css';

const SECTIONS: ReadonlyArray<{
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { href: '/settings/profile', label: 'Edit profile', icon: UserRound },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/appearance', label: 'Appearance', icon: Palette },
];

/**
 * Settings frame. Desktop: side nav next to the active section. Mobile: the
 * nav is the `/settings` page itself and each section opens full-width.
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isSignedIn, logout } = useAuth();
  const isHub = pathname === '/settings' || pathname === '/settings/';

  return (
    <div className={cx(styles.page, isHub && styles.hub)}>
      <nav className={styles.nav} aria-label="Settings">
        <p className={styles.navTitle}>Settings</p>
        <ul className={styles.list}>
          {SECTIONS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cx(styles.item, active && styles.active)}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className={styles.label}>{label}</span>
                  <ChevronRight
                    size={18}
                    aria-hidden="true"
                    className={styles.chevron}
                  />
                </Link>
              </li>
            );
          })}
          {isSignedIn && (
            <li className={styles.logout}>
              <button
                type="button"
                className={cx(styles.item, styles.danger)}
                onClick={() => {
                  logout();
                  router.push('/login');
                }}
              >
                <LogOut size={20} aria-hidden="true" />
                <span className={styles.label}>Log out</span>
              </button>
            </li>
          )}
        </ul>
      </nav>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
