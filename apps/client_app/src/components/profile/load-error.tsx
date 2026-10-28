import { Button } from '../ui/button';

import styles from './load-error.module.css';

interface LoadErrorProps {
  message: string;
  onRetry?: () => void;
}

/** Inline failure message with a retry action. */
export function LoadError({ message, onRetry }: LoadErrorProps) {
  return (
    <div className={styles.error} role="alert">
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
