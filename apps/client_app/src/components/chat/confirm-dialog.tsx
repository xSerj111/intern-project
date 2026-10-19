'use client';

import type { ReactNode } from 'react';

import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

import styles from './confirm-dialog.module.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  busy?: boolean;
  /** Failure text from the last attempt. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small confirmation modal; replaces `window.confirm`. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={title}
      description={description}
      size="sm"
      flush={!error}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
