import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from '../../lib/cx';

import styles from './empty-state.module.css';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Call to action, e.g. a Button or Link. */
  action?: ReactNode;
  className?: string;
}

/** Centered placeholder for lists with nothing to show yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={36} strokeWidth={1.5} />
      </span>
      <h2 className={styles.title}>{title}</h2>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
