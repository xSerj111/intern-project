'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  House,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  MessageCircle,
  Monitor,
  Moon,
  Search,
  Settings,
  SquarePlus,
  Sun,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { getMyProfile, profileKeys } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import {
  useTotalUnreadCount,
  useUnseenCount,
} from '../../lib/realtime/notification-cache';
import { useTheme } from '../../lib/theme/theme-provider';
import { Logo } from '../brand/logo';
import { Avatar } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { buttonClassName } from '../ui/button';
import { Menu, type MenuEntry } from '../ui/menu';

import styles from './app-shell.module.css';
import { ComposerProvider, useComposer } from './composer-context';

interface NavEntry {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Link target; entries without one are actions. */
  href?: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
  badgeLabel?: string;
  /** Rendered instead of `icon` (the profile avatar). */
  visual?: ReactNode;
}

function useNavEntries(): NavEntry[] {
  const pathname = usePathname();
  const { isSignedIn, user, accessToken } = useAuth();
  const unread = useTotalUnreadCount();
  const unseen = useUnseenCount() ?? 0;
  const { openComposer } = useComposer();

  const profile = useQuery({
    queryKey: profileKeys.me(user?.id),
    queryFn: ({ signal }) => getMyProfile(accessToken, signal),
    enabled: Boolean(accessToken),
  });

  if (!isSignedIn) {
    return [
      { key: 'home', label: 'Home', icon: House, href: '/', active: pathname === '/' },
      {
        key: 'search',
        label: 'Search',
        icon: Search,
        href: '/search',
        active: pathname.startsWith('/search') || pathname.startsWith('/tags'),
      },
      { key: 'login', label: 'Log in', icon: LogIn, href: '/login' },
      { key: 'signup', label: 'Sign up', icon: UserPlus, href: '/signup' },
    ];
  }

  const name = profile.data?.displayName ?? user?.email ?? 'You';
  return [
    { key: 'home', label: 'Home', icon: House, href: '/', active: pathname === '/' },
    {
      key: 'search',
      label: 'Search',
      icon: Search,
      href: '/search',
      active: pathname.startsWith('/search') || pathname.startsWith('/tags'),
    },
    {
      key: 'messages',
      label: 'Messages',
      icon: MessageCircle,
      href: '/messages',
      active: pathname.startsWith('/messages'),
      badge: unread,
      badgeLabel: `${unread} unread messages`,
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: Bell,
      href: '/notifications',
      active: pathname.startsWith('/notifications'),
      badge: unseen,
      badgeLabel: `${unseen} unseen notifications`,
    },
    { key: 'create', label: 'Create', icon: SquarePlus, onClick: openComposer },
    {
      key: 'profile',
      label: 'Profile',
      href: '/profile',
      active: pathname === '/profile' || pathname === `/profile/${user?.id}`,
      visual: (
        <Avatar
          src={profile.data?.avatarUrl}
          name={name}
          size="xs"
          decorative
          className={styles.navAvatar}
        />
      ),
    },
  ];
}

function NavItem({ entry, compact }: { entry: NavEntry; compact?: boolean }) {
  const Icon = entry.icon;
  const content = (
    <>
      <span className={styles.navIcon}>
        {entry.visual ??
          (Icon && (
            <Icon size={26} strokeWidth={entry.active ? 2.6 : 1.9} aria-hidden="true" />
          ))}
        {entry.badge !== undefined && (
          <Badge
            count={entry.badge}
            label={entry.badgeLabel}
            className={styles.navBadge}
          />
        )}
      </span>
      <span className={compact ? 'visually-hidden' : styles.navLabel}>
        {entry.label}
      </span>
    </>
  );
  const className = cx(
    styles.navItem,
    entry.active && styles.active,
    entry.key === 'profile' && entry.active && styles.activeAvatar,
  );

  return entry.href ? (
    <Link
      href={entry.href}
      className={className}
      aria-current={entry.active ? 'page' : undefined}
      title={entry.label}
    >
      {content}
    </Link>
  ) : (
    <button type="button" className={className} onClick={entry.onClick} title={entry.label}>
      {content}
    </button>
  );
}

function useMoreEntries(): MenuEntry[] {
  const router = useRouter();
  const { logout } = useAuth();
  const { preference, setPreference } = useTheme();

  return [
    { label: 'Settings', icon: Settings, onSelect: () => router.push('/settings') },
    { type: 'separator' },
    { type: 'label', label: 'Appearance' },
    { label: 'System', icon: Monitor, checked: preference === 'system', onSelect: () => setPreference('system') },
    { label: 'Light', icon: Sun, checked: preference === 'light', onSelect: () => setPreference('light') },
    { label: 'Dark', icon: Moon, checked: preference === 'dark', onSelect: () => setPreference('dark') },
    { type: 'separator' },
    {
      label: 'Log out',
      icon: LogOut,
      onSelect: () => {
        logout();
        router.push('/login');
      },
    },
  ];
}

function MoreMenu({ variant }: { variant: 'sidebar' | 'topbar' }) {
  const entries = useMoreEntries();
  return variant === 'sidebar' ? (
    <Menu
      label="More"
      entries={entries}
      placement="top"
      align="start"
      triggerClassName={styles.navItem}
      trigger={
        <>
          <span className={styles.navIcon}>
            <MenuIcon size={26} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <span className={styles.navLabel}>More</span>
        </>
      }
    />
  ) : (
    <Menu
      label="More"
      entries={entries}
      trigger={<MenuIcon size={24} aria-hidden="true" />}
    />
  );
}

function Sidebar({ entries }: { entries: NavEntry[] }) {
  const { isHydrated, isSignedIn } = useAuth();
  return (
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand} aria-label="Innogram home">
        <span className={styles.brandFull}>
          <Logo />
        </span>
        <span className={styles.brandMark}>
          <Logo markOnly />
        </span>
      </Link>
      <nav aria-label="Primary" className={styles.sidebarNav}>
        {isHydrated && (
          <ul className={styles.navList}>
            {entries.map((entry) => (
              <li key={entry.key}>
                <NavItem entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </nav>
      {isHydrated && isSignedIn && (
        <div className={styles.sidebarFooter}>
          <MoreMenu variant="sidebar" />
        </div>
      )}
    </aside>
  );
}

function TopBar() {
  const { isHydrated, isSignedIn } = useAuth();
  return (
    <header className={styles.topbar}>
      <Link href="/" aria-label="Innogram home">
        <Logo />
      </Link>
      {isHydrated &&
        (isSignedIn ? (
          <MoreMenu variant="topbar" />
        ) : (
          <Link href="/login" className={buttonClassName({ size: 'sm' })}>
            Log in
          </Link>
        ))}
    </header>
  );
}

function BottomBar({ entries }: { entries: NavEntry[] }) {
  return (
    <nav aria-label="Primary" className={styles.bottombar}>
      {entries.map((entry) => (
        <NavItem key={entry.key} entry={entry} compact />
      ))}
    </nav>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const { isHydrated, isSignedIn } = useAuth();
  const entries = useNavEntries();

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <Sidebar entries={entries} />
      <TopBar />
      <main id="main-content" className={styles.main}>
        {children}
      </main>
      {isHydrated && isSignedIn && <BottomBar entries={entries} />}
    </div>
  );
}

/**
 * App chrome: a left sidebar on desktop (icon rail on tablets), a top bar and
 * bottom tab bar on phones. Owns the page's `<main>` landmark.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ComposerProvider>
      <ShellFrame>{children}</ShellFrame>
    </ComposerProvider>
  );
}
