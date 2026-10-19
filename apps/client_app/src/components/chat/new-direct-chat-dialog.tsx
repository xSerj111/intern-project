'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { IChatUser } from '@repo/contracts';

import { chatKeys, createDirectChat } from '../../lib/api/chats';
import { listFollowers, listFollowing } from '../../lib/api/follows';
import { getUsersByIds, searchProfiles } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';

import styles from './new-direct-chat-dialog.module.css';

export interface Suggestion {
  userId: string;
  relation: string;
  /** Resolved display name; undefined while loading or for unknown users. */
  displayName?: string;
  username?: string;
}

/**
 * Followers/following of the caller (ids only from the follows API), with names
 * resolved through one batched `getUsersByIds` call.
 */
export function useFollowSuggestions(enabled: boolean) {
  const { accessToken, user } = useAuth();
  const me = user?.id;

  const base = useQuery({
    queryKey: ['chats', 'suggestions', me],
    queryFn: async ({ signal }): Promise<Suggestion[]> => {
      const [following, followers] = await Promise.all([
        listFollowing(me!, { token: accessToken, signal }),
        listFollowers(me!, { token: accessToken, signal }),
      ]);
      const seen = new Set<string>();
      const out: Suggestion[] = [];
      const add = (userId: string, relation: string) => {
        if (userId !== me && !seen.has(userId)) {
          seen.add(userId);
          out.push({ userId, relation });
        }
      };
      following.forEach((f) => add(f.followingId, 'Following'));
      followers.forEach((f) => add(f.followerId, 'Follower'));
      return out;
    },
    enabled: enabled && Boolean(accessToken) && Boolean(me),
  });

  const ids = base.data?.map((s) => s.userId) ?? [];
  const names = useQuery({
    queryKey: ['chats', 'suggestion-names', ...ids],
    queryFn: ({ signal }) => getUsersByIds(ids, accessToken, signal),
    enabled: ids.length > 0 && Boolean(accessToken),
    staleTime: 60_000,
  });

  const byId = new Map((names.data ?? []).map((u) => [u.userId, u]));
  const data = base.data?.map((s) => ({
    ...s,
    displayName: byId.get(s.userId)?.displayName,
    username: byId.get(s.userId)?.username,
  }));

  return {
    data,
    isPending: base.isPending,
    isError: base.isError,
    isSuccess: base.isSuccess,
  };
}

interface NewDirectChatDialogProps {
  onClose: () => void;
}

/** Pick any user (search) or a follower/following suggestion and open a direct chat. */
export function NewDirectChatDialog({ onClose }: NewDirectChatDialogProps) {
  const { accessToken, user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [opening, setOpening] = useState(false);
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

  const open = async (userId: string) => {
    setOpening(true);
    setError(null);
    try {
      const chat = await createDirectChat(userId, { token: accessToken });
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      router.push(`/messages/${chat.id}`);
      onClose();
    } catch {
      setError('Could not open the conversation. Please try again.');
      setOpening(false);
    }
  };

  const users: IChatUser[] = (results.data ?? []).filter(
    (u) => u.userId !== me,
  );

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
        aria-label="New message"
      >
        <div className={styles.header}>
          <h2 className={styles.heading}>New message</h2>
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
          type="search"
          placeholder="Search by username"
          aria-label="Search users"
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoFocus
        />

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {searching ? (
          <>
            {results.isPending && <span className="muted">Searching…</span>}
            {results.isError && (
              <p className={styles.error} role="alert">
                Search failed. Please try again.
              </p>
            )}
            {results.isSuccess && users.length === 0 && (
              <span className="muted">No users found.</span>
            )}
            <ul className={styles.list}>
              {users.map((u) => (
                <li key={u.userId}>
                  <button
                    type="button"
                    className={styles.option}
                    disabled={opening}
                    onClick={() => void open(u.userId)}
                  >
                    <span className={styles.optionName}>{u.displayName}</span>
                    <span className={styles.optionMeta}>@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <span className={styles.subheading}>Suggestions</span>
            {suggestions.isPending && (
              <span className="muted">Loading suggestions…</span>
            )}
            {suggestions.isError && (
              <span className="muted">Could not load suggestions.</span>
            )}
            {suggestions.isSuccess && (suggestions.data?.length ?? 0) === 0 && (
              <span className="muted">
                Follow someone, or search above to find anyone.
              </span>
            )}
            <ul className={styles.list}>
              {suggestions.data?.map((s) => (
                <li key={s.userId}>
                  <button
                    type="button"
                    className={styles.option}
                    disabled={opening}
                    onClick={() => void open(s.userId)}
                  >
                    <span className={styles.optionName}>
                      {s.displayName ?? `User ${s.userId.slice(0, 8)}`}
                    </span>
                    <span className={styles.optionMeta}>
                      {s.username ? `@${s.username} · ` : ''}
                      {s.relation}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
