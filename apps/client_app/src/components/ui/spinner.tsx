import { cx } from '../../lib/cx';

import styles from './spinner.module.css';

interface SpinnerProps {
  /** Diameter in px. */
  size?: number;
  /** Announce as a loading status (otherwise decorative). */
  label?: string;
  className?: string;
}

/** Indeterminate circular spinner; inherits `currentColor`. */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <svg
      className={cx(styles.spinner, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
