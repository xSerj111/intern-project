'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { chatKeys, createGroupChat } from '../../lib/api/chats';
import { searchProfiles } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';

import { useFollowSuggestions } from './new-direct-chat-dialog';

import styles from './new-group-dialog.module.css';

const TITLE_MAX = 100;
const MEMBERS_MIN = 2;
const MEMBERS_MAX = 99;

interface NewGroupDialogProps {
  onClose: () => void;
}

interface Candidate {
  userId: string;
  name: string;
  meta: string;
}

/** Name the group, pick 2-99 other people (search or suggestions) and create it. */
export function NewGroupDialog({ onClose }: NewGroupDialogProps) {
  const { accessToken, user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const me = user?.id;
  const searching = term.length > 0;

  const results = useQuery({
    queryKey: ['chats', 'user-search', term],
    queryFn: ({ signal }) =>
      searchProfiles({ q: term, limit: 20 }, accessToken, signal),
    enabled: searching && Boolean(accessToken),
  });
  const suggestions = useFollowSuggestions(!searching);

  const toggle = (pick: Candidate) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(pick.userId)) {
        next.delete(pick.userId);
      } else if (next.size < MEMBERS_MAX) {
        next.set(pick.userId, pick);
      }
      return next;
    });
  };

  const trimmedTitle = title.trim();
  const valid =
    trimmedTitle.length >= 1 &&
    trimmedTitle.length <= TITLE_MAX &&
    selected.size >= MEMBERS_MIN &&
    selected.size <= MEMBERS_MAX;

  const create = async () => {
    if (!valid || creating) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const chat = await createGroupChat(
        { title: trimmedTitle, memberIds: [...selected.keys()] },
        { token: accessToken },
      );
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      router.push(`/messages/${chat.id}`);
      onClose();
    } catch {
      setError('Could not create the group. Please try again.');
      setCreating(false);
    }
  };

  const options: Candidate[] = searching
    ? (results.data ?? [])
        .filter((u) => u.userId !== me)
        .map((u) => ({
          userId: u.userId,
          name: u.displayName,
          meta: `@${u.username}`,
        }))
    : (suggestions.data ?? []).map((s) => ({
        userId: s.userId,
        name: s.displayName ?? `User ${s.userId.slice(0, 8)}`,
        meta: `${s.username ? `@${s.username} · ` : ''}${s.relation}`,
      }));

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="New group"
      >
        <div className={styles.header}>
          <h2 className={styles.heading}>New group</h2>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <input
          className="input"
          type="text"
          placeholder="Group name"
          aria-label="Group name"
          maxLength={TITLE_MAX}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />

        {selected.size > 0 && (
          <ul className={styles.chips} aria-label="Selected members">
            {[...selected.values()].map((p) => (
              <li key={p.userId} className={styles.chip}>
                {p.name}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove ${p.name}`}
                  onClick={() => toggle(p)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          className="input"
          type="search"
          placeholder="Search by username"
          aria-label="Search users"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        {!searching && <span className={styles.subheading}>Suggestions</span>}
        {searching && results.isPending && (
          <span className="muted">Searching…</span>
        )}
        {searching && results.isError && (
          <p className={styles.error} role="alert">
            Search failed. Please try again.
          </p>
        )}
        {searching && results.isSuccess && options.length === 0 && (
          <span className="muted">No users found.</span>
        )}
        {!searching && suggestions.isPending && (
          <span className="muted">Loading suggestions…</span>
        )}
        {!searching && suggestions.isError && (
          <span className="muted">Could not load suggestions.</span>
        )}
        {!searching && suggestions.isSuccess && options.length === 0 && (
          <span className="muted">
            Follow someone, or search above to find anyone.
          </span>
        )}
        <ul className={styles.list}>
          {options.map((o) => {
            const checked = selected.has(o.userId);
            return (
              <li key={o.userId}>
                <button
                  type="button"
                  className={styles.option}
                  aria-pressed={checked}
                  disabled={
                    creating || (!checked && selected.size >= MEMBERS_MAX)
                  }
                  onClick={() => toggle(o)}
                >
                  <span className={styles.optionText}>
                    <span className={styles.optionName}>{o.name}</span>
                    <span className={styles.optionMeta}>{o.meta}</span>
                  </span>
                  {checked && <span className={styles.check}>✓</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.footer}>
          <span className="muted">
            {selected.size} selected (pick at least {MEMBERS_MIN})
          </span>
          <button
            type="button"
            className="button"
            disabled={!valid || creating}
            onClick={() => void create()}
          >
            {creating ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  );
}
