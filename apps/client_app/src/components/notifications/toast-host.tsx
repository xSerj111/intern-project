'use client';

import Link from 'next/link';

import { dismissToast, useToasts } from '../../lib/realtime/notification-cache';

import styles from './toast-host.module.css';

/** Transient new-message toasts (`chat:alert`), mounted once in the root layout. */
export function ToastHost() {
  const toasts = useToasts();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={styles.host} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast}>
          <Link
            href={toast.href}
            className={styles.link}
            onClick={() => dismissToast(toast.id)}
          >
            {toast.text}
          </Link>
          <button
            type="button"
            className={styles.close}
            aria-label="Dismiss notification"
            onClick={() => dismissToast(toast.id)}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
