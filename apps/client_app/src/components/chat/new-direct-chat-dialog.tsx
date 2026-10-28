'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { IChatUser } from '@repo/contracts';

import { chatKeys, createDirectChat } from '../../lib/api/chats';
import { getFollowers, getFollowing } from '../../lib/api/follows';
import { getUsersByIds, searchProfiles } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';

import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';
import { Spinner } from '../ui/spinner';

import styles from './new-direct-chat-dialog.module.css';
import { UserOption } from './user-option';

export interface Suggestion {
  userId: string;
  relation: string;
  /** Resolved display name; undefined while loading or for unknown users. */
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
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
        getFollowing(me!, { token: accessToken, signal }),
        getFollowers(me!, { token: accessToken, signal }),
      ]);
      const seen = new Set<string>();
      const out: Suggestion[] = [];
      const add = (userId: string, relation: string) => {
        if (userId !== me && !seen.has(userId)) {
          seen.add(userId);
          out.push({ userId, relation });
        }
      };
      following.items.forEach((f) => add(f.followingId, 'Following'));
      followers.items.forEach((f) => add(f.followerId, 'Follower'));
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
    avatarUrl: byId.get(s.userId)?.avatarUrl,
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  // The dialog is opened by an effect of its own, so focus the field after it.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

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
    <Dialog open onClose={onClose} title="New message" size="sm">
      <div className={styles.content}>
        <Input
          ref={searchRef}
          type="search"
          placeholder="Search by username"
          aria-label="Search users"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {searching ? (
          <>
            {results.isPending && (
              <p className={styles.status} role="status">
                <Spinner size={14} /> Searching…
              </p>
            )}
            {results.isError && (
              <p className={styles.error} role="alert">
                Search failed. Please try again.
              </p>
            )}
            {results.isSuccess && users.length === 0 && (
              <p className={styles.status}>No users found.</p>
            )}
            <ul className={styles.list}>
              {users.map((u) => (
                <li key={u.userId}>
                  <UserOption
                    name={u.displayName}
                    meta={`@${u.username}`}
                    avatarUrl={u.avatarUrl}
                    disabled={opening}
                    onClick={() => void open(u.userId)}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h3 className={styles.subheading}>Suggestions</h3>
            {suggestions.isPending && (
              <p className={styles.status} role="status">
                <Spinner size={14} /> Loading suggestions…
              </p>
            )}
            {suggestions.isError && (
              <p className={styles.status}>Could not load suggestions.</p>
            )}
            {suggestions.isSuccess && (suggestions.data?.length ?? 0) === 0 && (
              <p className={styles.status}>
                Follow someone, or search above to find anyone.
              </p>
            )}
            <ul className={styles.list}>
              {suggestions.data?.map((s) => (
                <li key={s.userId}>
                  <UserOption
                    name={s.displayName ?? `User ${s.userId.slice(0, 8)}`}
                    meta={`${s.username ? `@${s.username} · ` : ''}${s.relation}`}
                    avatarUrl={s.avatarUrl}
                    disabled={opening}
                    onClick={() => void open(s.userId)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
