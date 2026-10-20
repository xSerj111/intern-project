import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from './settings-header.module.css';

interface SettingsHeaderProps {
  title: string;
  description?: ReactNode;
}

/** Page title for a settings section; shows a back link on phones. */
export function SettingsHeader({ title, description }: SettingsHeaderProps) {
  return (
    <header className={styles.header}>
      <Link
        href="/settings"
        className={styles.back}
        aria-label="Back to settings"
      >
        <ChevronLeft size={24} aria-hidden="true" />
      </Link>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
    </header>
  );
}
