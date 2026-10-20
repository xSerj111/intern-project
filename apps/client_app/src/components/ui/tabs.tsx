'use client';

import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import { cx } from '../../lib/cx';

import styles from './tabs.module.css';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab/panel ids; pair panels with {@link tabPanelProps}. */
  idPrefix: string;
  className?: string;
}

/** Props for the panel shown by the tab `id` (role, id, labelling). */
export function tabPanelProps(idPrefix: string, id: string) {
  return {
    role: 'tabpanel' as const,
    id: `${idPrefix}-panel-${id}`,
    'aria-labelledby': `${idPrefix}-tab-${id}`,
  };
}

/** Underlined tab bar with roving focus (arrow keys, Home/End). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft')
      next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;

    event.preventDefault();
    onChange(items[next].id);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cx(styles.tabs, className)}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const selected = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(item.id)}
          >
            {Icon && <Icon size={16} aria-hidden="true" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
