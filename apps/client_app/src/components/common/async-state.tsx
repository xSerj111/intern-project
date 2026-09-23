'use client';

import styles from './async-state.module.css';

interface LoadingStateProps {
  /** Human-readable status, e.g. "Loading your feed…". */
  label?: string;
}

/** Skeleton placeholder shown while a query is in flight. */
export function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <div className={styles.skeleton} aria-hidden="true">
        <div className={styles.skeletonLine} />
        <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
        <div className={styles.skeletonLine} />
      </div>
      <span className="muted">{label}</span>
    </div>
  );
}

interface ErrorStateProps {
  /** Friendly message describing the failure. */
  message?: string;
  /** Retry handler (also retried automatically on an interval). */
  onRetry?: () => void;
}

/**
 * Friendly error state with a manual retry affordance. Automatic recovery is
 * handled by the query client's `refetchInterval` (FR-007).
 */
export function ErrorState({
  message = 'Something went wrong while loading this content.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
