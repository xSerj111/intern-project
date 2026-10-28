'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';

import { cx } from '../../lib/cx';

import styles from './input.module.css';

interface FieldOwnProps {
  /** Visible label. Omit only when the control has an `aria-label`. */
  label?: ReactNode;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error text; also marks the control `aria-invalid`. */
  error?: ReactNode;
  /** Content inside the control's right edge (e.g. a show-password toggle). */
  trailing?: ReactNode;
}

function describedBy(id: string, hint: unknown, error: unknown) {
  return (
    cx(Boolean(error) && `${id}-error`, Boolean(hint) && `${id}-hint`) ||
    undefined
  );
}

function FieldFrame({
  id,
  label,
  hint,
  error,
  children,
}: FieldOwnProps & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export interface InputProps
  extends InputHTMLAttributes<HTMLInputElement>,
    FieldOwnProps {
  ref?: Ref<HTMLInputElement>;
}

/** Text input with optional label, hint and error. */
export function Input({
  label,
  hint,
  error,
  trailing,
  id,
  className,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <FieldFrame id={inputId} label={label} hint={hint} error={error}>
      <div className={styles.control}>
        <input
          id={inputId}
          className={cx(styles.input, Boolean(trailing) && styles.withTrailing, className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(inputId, hint, error)}
          {...rest}
        />
        {trailing && <span className={styles.trailing}>{trailing}</span>}
      </div>
    </FieldFrame>
  );
}

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    Omit<FieldOwnProps, 'trailing'> {
  ref?: Ref<HTMLTextAreaElement>;
}

/** Multi-line input with optional label, hint and error. */
export function Textarea({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <FieldFrame id={inputId} label={label} hint={hint} error={error}>
      <textarea
        id={inputId}
        className={cx(styles.input, styles.textarea, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        {...rest}
      />
    </FieldFrame>
  );
}
