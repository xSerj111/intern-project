'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './nav-links.module.css';

interface NavLink {
  href: string;
  label: string;
}

/** Baseline primary destinations (spec Assumptions: Home/Feed and Profile). */
const LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Search' },
  { href: '/compose', label: 'Compose' },
  { href: '/profile', label: 'Profile' },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="Primary">
      {LINKS.map((link) => {
        const isActive =
          link.href === '/'
            ? pathname === '/'
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={isActive ? `${styles.link} ${styles.active}` : styles.link}
            aria-current={isActive ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
