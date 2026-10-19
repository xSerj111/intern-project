import type { ReactNode } from 'react';

import { cx } from '../../lib/cx';
import { Avatar } from '../ui/avatar';

import styles from './user-option.module.css';

interface UserOptionProps {
  name: string;
  /** Second line, e.g. `@username · Following`. */
  meta?: string;
  avatarUrl?: string | null;
  /** Content on the right edge (check mark, action). */
  trailing?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Toggle semantics for multi-select lists. */
  pressed?: boolean;
}

/** Selectable row with an avatar, used by the new-chat dialogs. */
export function UserOption({
  name,
  meta,
  avatarUrl,
  trailing,
  onClick,
  disabled,
  pressed,
}: UserOptionProps) {
  return (
    <button
      type="button"
      className={cx(styles.option, pressed && styles.pressed)}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Avatar src={avatarUrl} name={name} size="md" decorative />
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </span>
      {trailing}
    </button>
  );
}
