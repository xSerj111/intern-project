'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { chatKeys, createGroupChat } from '../../lib/api/chats';
import { searchProfiles } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';
import { Spinner } from '../ui/spinner';

import { useFollowSuggestions } from './new-direct-chat-dialog';
import styles from './new-group-dialog.module.css';
import { UserOption } from './user-option';

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
  avatarUrl?: string | null;
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
          avatarUrl: u.avatarUrl,
        }))
    : (suggestions.data ?? []).map((s) => ({
        userId: s.userId,
        name: s.displayName ?? `User ${s.userId.slice(0, 8)}`,
        meta: `${s.username ? `@${s.username} · ` : ''}${s.relation}`,
        avatarUrl: s.avatarUrl,
      }));

  return (
    <Dialog
      open
      onClose={onClose}
      title="New group"
      size="sm"
      footer={
        <>
          <span className={styles.count}>
            {selected.size} selected
            {selected.size < MEMBERS_MIN && ` (pick at least ${MEMBERS_MIN})`}
          </span>
          <Button
            disabled={!valid}
            loading={creating}
            onClick={() => void create()}
          >
            Create group
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <Input
          label="Group name"
          type="text"
          placeholder="Weekend plans"
          maxLength={TITLE_MAX}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        {selected.size > 0 && (
          <ul className={styles.chips} aria-label="Selected members">
            {[...selected.values()].map((p) => (
              <li key={p.userId} className={styles.chip}>
                <Avatar src={p.avatarUrl} name={p.name} size="xs" decorative />
                <span className={styles.chipName}>{p.name}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove ${p.name}`}
                  onClick={() => toggle(p)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Input
          type="search"
          placeholder="Search by username"
          aria-label="Search users"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        {!searching && <h3 className={styles.subheading}>Suggestions</h3>}
        {searching && results.isPending && (
          <p className={styles.status} role="status">
            <Spinner size={14} /> Searching…
          </p>
        )}
        {searching && results.isError && (
          <p className={styles.error} role="alert">
            Search failed. Please try again.
          </p>
        )}
        {searching && results.isSuccess && options.length === 0 && (
          <p className={styles.status}>No users found.</p>
        )}
        {!searching && suggestions.isPending && (
          <p className={styles.status} role="status">
            <Spinner size={14} /> Loading suggestions…
          </p>
        )}
        {!searching && suggestions.isError && (
          <p className={styles.status}>Could not load suggestions.</p>
        )}
        {!searching && suggestions.isSuccess && options.length === 0 && (
          <p className={styles.status}>
            Follow someone, or search above to find anyone.
          </p>
        )}
        <ul className={styles.list}>
          {options.map((o) => {
            const checked = selected.has(o.userId);
            return (
              <li key={o.userId}>
                <UserOption
                  name={o.name}
                  meta={o.meta}
                  avatarUrl={o.avatarUrl}
                  pressed={checked}
                  disabled={
                    creating || (!checked && selected.size >= MEMBERS_MAX)
                  }
                  onClick={() => toggle(o)}
                  trailing={
                    <span
                      className={checked ? styles.checkOn : styles.checkOff}
                      aria-hidden="true"
                    >
                      {checked && <Check size={14} strokeWidth={3} />}
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
