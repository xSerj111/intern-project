import { useId } from 'react';

import styles from './logo.module.css';

interface LogoProps {
  /** Hide the wordmark and render only the mark. */
  markOnly?: boolean;
}

/**
 * Innogram brand lockup (mark + wordmark), shared by the app shell, auth
 * screens and error pages.
 */
export function Logo({ markOnly = false }: LogoProps) {
  // Unique per instance: the logo can appear more than once on a page.
  const gradientId = useId();

  return (
    <span className={styles.logo} aria-label="Innogram">
      <svg
        className={styles.mark}
        width="28"
        height="28"
        viewBox="0 0 32 32"
        role="img"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-violet)" />
            <stop offset="55%" stopColor="var(--brand-fuchsia)" />
            <stop offset="100%" stopColor="var(--brand-pink)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
        <circle
          cx="16"
          cy="16"
          r="6.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
        />
        <circle cx="23.5" cy="8.5" r="2" fill="#ffffff" />
      </svg>
      {!markOnly && <span className={styles.wordmark}>Innogram</span>}
    </span>
  );
}
