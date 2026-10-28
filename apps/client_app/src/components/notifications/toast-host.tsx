'use client';

import { MessageCircle, X } from 'lucide-react';
import Link from 'next/link';

import { dismissToast, useToasts } from '../../lib/realtime/notification-cache';
import { IconButton } from '../ui/button';

import styles from './toast-host.module.css';

/**
 * Transient new-message toasts (`chat:alert`), mounted once in the root layout.
 * Top-centre on phones (clear of the bottom tab bar), bottom-right on desktop.
 */
export function ToastHost() {
  const toasts = useToasts();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={styles.host} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast}>
          <span className={styles.icon} aria-hidden="true">
            <MessageCircle size={16} />
          </span>
          <Link
            href={toast.href}
            className={styles.link}
            onClick={() => dismissToast(toast.id)}
          >
            {toast.text}
          </Link>
          <IconButton
            label="Dismiss notification"
            size="sm"
            onClick={() => dismissToast(toast.id)}
          >
            <X size={16} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
