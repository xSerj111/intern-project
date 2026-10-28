import { cx } from '../../lib/cx';

import styles from './badge.module.css';

interface BadgeProps {
  count: number;
  /** Shown as `{max}+` above this. */
  max?: number;
  variant?: 'danger' | 'primary' | 'neutral';
  /** Accessible text, e.g. "3 unread messages"; otherwise decorative. */
  label?: string;
  className?: string;
}

/** Count pill; renders nothing for counts of 0 or less. */
export function Badge({
  count,
  max = 99,
  variant = 'danger',
  label,
  className,
}: BadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(styles.badge, styles[variant], className)}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

/** Small unread dot. */
export function Dot({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      className={cx(styles.dot, className)}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
    />
  );
}
