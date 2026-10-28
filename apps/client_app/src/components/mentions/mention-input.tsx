'use client';

import { useQuery } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
  type SyntheticEvent,
} from 'react';

import { searchProfiles } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { Avatar } from '../ui/avatar';
import { Textarea } from '../ui/input';

import {
  findMentionAtCaret,
  insertMention,
  MIN_SEARCH_LENGTH,
  type MentionTrigger,
} from './mention-parser';
import styles from './mention-input.module.css';

interface MentionInputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Textarea instead of a single-line input. */
  multiline?: boolean;
  /** Class for the single-line `<input>`. */
  inputClassName?: string;
  maxLength?: number;
  placeholder?: string;
  'aria-label': string;
  autoFocus?: boolean;
  rows?: number;
  /** Called on Esc while the suggestion list is closed (e.g. cancel an inline form). */
  onEscape?: () => void;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Text field that suggests users while typing `@name` and inserts `@username`.
 * Up/Down move, Enter or Tab pick, Esc closes the list (or calls `onEscape`
 * when it is already closed). Falls back to a plain field
 * while signed out or when the search fails.
 */
export function MentionInput({
  value,
  onValueChange,
  multiline = false,
  inputClassName,
  maxLength,
  placeholder,
  'aria-label': ariaLabel,
  autoFocus,
  rows,
  onEscape,
}: MentionInputProps) {
  const { accessToken } = useAuth();
  const listId = useId();
  const fieldRef = useRef<Field>(null);
  const pendingCaret = useRef<number | null>(null);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);

  const query = trigger?.query ?? '';
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const searching =
    Boolean(accessToken) &&
    term.length >= MIN_SEARCH_LENGTH &&
    term === query;
  const results = useQuery({
    queryKey: ['mentions', 'search', term.toLowerCase()],
    queryFn: ({ signal }) =>
      searchProfiles({ q: term, limit: 6 }, accessToken, signal),
    enabled: searching,
    staleTime: 30_000,
  });

  const suggestions = searching ? (results.data ?? []) : [];
  const open =
    trigger !== null && trigger.start !== dismissedAt && suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0));

  // Restore the caret after a pick replaced the value.
  useEffect(() => {
    if (pendingCaret.current === null) return;
    fieldRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  function track(field: Field) {
    const next = findMentionAtCaret(field.value, field.selectionStart ?? 0);
    setTrigger(next);
    setActive(0);
    // Esc only dismisses the mention it was pressed on.
    if (next?.start !== dismissedAt) setDismissedAt(null);
  }

  function pick(username: string) {
    if (!trigger) return;
    const next = insertMention(value, trigger, username);
    pendingCaret.current = next.caret;
    setTrigger(null);
    onValueChange(next.value);
    fieldRef.current?.focus();
  }

  function onChange(event: ChangeEvent<Field>) {
    onValueChange(event.target.value);
    track(event.target);
  }

  function onSelect(event: SyntheticEvent<Field>) {
    track(event.currentTarget);
  }

  function onKeyDown(event: KeyboardEvent<Field>) {
    if (!open) {
      if (event.key === 'Escape' && onEscape) {
        // preventDefault keeps the post view's own Esc handler from closing it.
        event.preventDefault();
        onEscape();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pick(suggestions[activeIndex].username);
    } else if (event.key === 'Escape') {
      // preventDefault keeps the post view's own Esc handler from closing it.
      event.preventDefault();
      setDismissedAt(trigger?.start ?? null);
    }
  }

  const shared = {
    value,
    maxLength,
    placeholder,
    autoFocus,
    autoComplete: 'off',
    role: 'combobox',
    'aria-label': ariaLabel,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    'aria-activedescendant': open ? `${listId}-${activeIndex}` : undefined,
    onChange,
    onSelect,
    onKeyDown,
    onBlur: () => setTrigger(null),
  };

  return (
    <div className={styles.wrapper}>
      {multiline ? (
        <Textarea
          {...shared}
          ref={fieldRef as Ref<HTMLTextAreaElement>}
          rows={rows}
        />
      ) : (
        <input
          {...shared}
          ref={fieldRef as Ref<HTMLInputElement>}
          className={inputClassName}
        />
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention suggestions"
          className={styles.list}
          // Keep focus in the field so the blur handler doesn't close the list first.
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((user, index) => (
            <li
              key={user.userId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={styles.option}
              onClick={() => pick(user.username)}
              onMouseMove={() => setActive(index)}
            >
              <Avatar
                src={user.avatarUrl}
                name={user.displayName || user.username}
                size="xs"
                decorative
              />
              <span className={styles.name}>
                {user.displayName || user.username}
              </span>
              <span className={styles.handle}>@{user.username}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
