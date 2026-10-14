'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useTotalUnreadCount } from '../../lib/realtime/notification-cache';

import styles from './nav-links.module.css';

interface NavLink {
  href: string;
  label: string;
}

/** Baseline primary destinations (spec Assumptions: Home/Feed and Profile). */
const LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/messages', label: 'Messages' },
  { href: '/profile', label: 'Profile' },
  { href: '/settings/notifications', label: 'Notification settings' },
];

export function NavLinks() {
  const pathname = usePathname();
  const unread = useTotalUnreadCount();

  return (
    <nav className={styles.nav} aria-label="Primary">
      {LINKS.map((link) => {
        const isActive =
          link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              isActive ? `${styles.link} ${styles.active}` : styles.link
            }
            aria-current={isActive ? 'page' : undefined}
          >
            {link.label}
            {link.href === '/messages' && unread > 0 && (
              <span
                className={styles.badge}
                aria-label={`${unread} unread messages`}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
