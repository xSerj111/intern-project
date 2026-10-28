'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cx } from '../../lib/cx';

import { IconButton } from './button';
import styles from './dialog.module.css';

export interface DialogProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close button. */
  onClose: () => void;
  title: ReactNode;
  /** Optional line under the title. */
  description?: ReactNode;
  /** Pinned under the scrollable body (e.g. action buttons). */
  footer?: ReactNode;
  /** Content left of the close button in the header (e.g. a "Share" action). */
  headerAction?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Edge-to-edge body without padding (media, lists). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Modal built on the native `<dialog>`: the browser handles focus trapping,
 * `inert` background and Esc. Renders as a bottom sheet on narrow screens.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  headerAction,
  size = 'md',
  flush = false,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Close if the component unmounts while open (e.g. route change).
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, styles[size], className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Keep `open` controlled by the parent.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the <dialog> itself (not its content) hit the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className={styles.panel}>
          <header className={styles.header}>
            <div className={styles.titles}>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className={styles.description}>
                  {description}
                </p>
              )}
            </div>
            {headerAction}
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </header>
          <div className={cx(styles.body, flush && styles.flush)}>
            {children}
          </div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
