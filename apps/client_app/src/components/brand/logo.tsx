import styles from './logo.module.css';

interface LogoProps {
  /** Hide the wordmark and render only the mark. */
  markOnly?: boolean;
}

/**
 * Innogram brand lockup (mark + wordmark), shared by the home screen and the
 * application header.
 */
export function Logo({ markOnly = false }: LogoProps) {
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
          <linearGradient id="innogram-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--innogram-primary)" />
            <stop offset="100%" stopColor="var(--innogram-accent)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#innogram-mark)" />
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
