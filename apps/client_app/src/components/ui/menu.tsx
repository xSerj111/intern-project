'use client';

import { Check, type LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cx } from '../../lib/cx';

import styles from './menu.module.css';

export type MenuEntry =
  | {
      type?: 'item';
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      /** Destructive action (red). */
      danger?: boolean;
      disabled?: boolean;
      /** Renders as a radio item (`menuitemradio`) with a check mark. */
      checked?: boolean;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string };

interface MenuProps {
  /** Accessible name of the trigger button. */
  label: string;
  /** Visible trigger content (an icon, or icon + text). */
  trigger: ReactNode;
  triggerClassName?: string;
  entries: MenuEntry[];
  /** Horizontal edge the popup aligns to. */
  align?: 'start' | 'end';
  /** Open below (default) or above the trigger. */
  placement?: 'bottom' | 'top';
}

/**
 * Dropdown menu (WAI-ARIA menu button): arrow keys move, Esc closes and returns
 * focus to the trigger, a click outside dismisses.
 */
export function Menu({
  label,
  trigger,
  triggerClassName,
  entries,
  align = 'end',
  placement = 'bottom',
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"]:not(:disabled)',
      ) ?? [],
    );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>

      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx(styles.menu, styles[align], styles[placement])}
          onKeyDown={onKeyDown}
        >
          {entries.map((entry, index) => {
            if (entry.type === 'separator') {
              return (
                <div key={index} role="separator" className={styles.separator} />
              );
            }
            if (entry.type === 'label') {
              return (
                <div key={index} className={styles.groupLabel} aria-hidden="true">
                  {entry.label}
                </div>
              );
            }
            const Icon = entry.icon;
            const isRadio = entry.checked !== undefined;
            return (
              <button
                key={index}
                type="button"
                role={isRadio ? 'menuitemradio' : 'menuitem'}
                aria-checked={isRadio ? entry.checked : undefined}
                tabIndex={-1}
                disabled={entry.disabled}
                className={cx(styles.item, entry.danger && styles.danger)}
                onClick={() => {
                  close(true);
                  entry.onSelect();
                }}
              >
                {Icon && <Icon size={18} aria-hidden="true" />}
                <span className={styles.itemLabel}>{entry.label}</span>
                {entry.checked && (
                  <Check size={16} aria-hidden="true" className={styles.check} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
