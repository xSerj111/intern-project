import { AlertCircle } from 'lucide-react';

import styles from './auth-form.module.css';

/** Form-level error banner (server errors that don't belong to one field). */
export function FormAlert({ message }: { message: string }) {
  return (
    <p className={styles.alert} role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
