'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { IConversationDetail } from '@repo/contracts';

import {
  addMembers,
  chatKeys,
  leaveChat,
  promoteMember,
  removeMember,
  renameGroup,
} from '../../lib/api/chats';
import { searchProfiles } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';

import styles from './group-members-panel.module.css';

const TITLE_MAX = 100;
const MEMBERS_MAX = 100;

interface GroupMembersPanelProps {
  chat: IConversationDetail;
  currentUserId?: string;
  /** Called after the current user has left the group. */
  onLeft: () => void;
}

/** Member list with roles; admins can rename, add, remove and promote. Everyone can leave. */
export function GroupMembersPanel({
  chat,
  currentUserId,
  onLeft,
}: GroupMembersPanelProps) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = chat.myRole === 'ADMIN';
  const [title, setTitle] = useState(chat.title ?? '');
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow server-side renames (own or someone else's).
  useEffect(() => {
    setTitle(chat.title ?? '');
  }, [chat.title]);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const memberIds = new Set(chat.participants.map((p) => p.userId));
  const full = chat.participants.length >= MEMBERS_MAX;

  const results = useQuery({
    queryKey: ['chats', 'user-search', term],
    queryFn: ({ signal }) =>
      searchProfiles({ q: term, limit: 20 }, accessToken, signal),
    enabled: isAdmin && term.length > 0 && Boolean(accessToken),
  });
  const candidates = (results.data ?? []).filter(
    (u) => !memberIds.has(u.userId),
  );

  const run = async (
    action: () => Promise<IConversationDetail | void>,
    failure: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      if (updated) {
        queryClient.setQueryData(chatKeys.detail(chat.id), updated);
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      return true;
    } catch {
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const nextTitle = title.trim();
  const canRename =
    isAdmin &&
    nextTitle.length >= 1 &&
    nextTitle.length <= TITLE_MAX &&
    nextTitle !== (chat.title ?? '');

  const rename = () =>
    run(
      () => renameGroup(chat.id, nextTitle, { token: accessToken }),
      'Could not rename the group.',
    );

  const add = async (userId: string) => {
    if (
      await run(
        () => addMembers(chat.id, [userId], { token: accessToken }),
        'Could not add that member.',
      )
    ) {
      setText('');
    }
  };

  const leave = async () => {
    if (!window.confirm('Leave this group?')) {
      return;
    }
    const ok = await run(async () => {
      await leaveChat(chat.id, { token: accessToken });
    }, 'Could not leave the group.');
    if (ok) {
      onLeft();
    }
  };

  const remove = (userId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the group?`)) {
      return;
    }
    return run(async () => {
      await removeMember(chat.id, userId, { token: accessToken });
      await queryClient.invalidateQueries({
        queryKey: chatKeys.detail(chat.id),
      });
    }, 'Could not remove that member.');
  };

  return (
    <section className={styles.panel} aria-label="Group members">
      <div className={styles.row}>
        <h2 className={styles.heading}>Members ({chat.participants.length})</h2>
        <button
          type="button"
          className={`button button--ghost ${styles.danger}`}
          disabled={busy}
          onClick={() => void leave()}
        >
          Leave group
        </button>
      </div>

      {isAdmin && (
        <form
          className={styles.rename}
          onSubmit={(event) => {
            event.preventDefault();
            if (canRename && !busy) {
              void rename();
            }
          }}
        >
          <input
            className="input"
            aria-label="Group name"
            maxLength={TITLE_MAX}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button
            type="submit"
            className="button"
            disabled={!canRename || busy}
          >
            Rename
          </button>
        </form>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {chat.participants.map((p) => {
          const isSelf = p.userId === currentUserId;
          return (
            <li key={p.userId} className={styles.member}>
              <span className={styles.memberText}>
                <span className={styles.memberName}>
                  {p.displayName}
                  {isSelf ? ' (you)' : ''}
                </span>
                <span className={styles.memberMeta}>
                  @{p.username} · {p.role === 'ADMIN' ? 'Admin' : 'Member'}
                </span>
              </span>
              {isAdmin && !isSelf && (
                <span className={styles.actions}>
                  {p.role !== 'ADMIN' && (
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            promoteMember(chat.id, p.userId, {
                              token: accessToken,
                            }),
                          'Could not promote that member.',
                        )
                      }
                    >
                      Make admin
                    </button>
                  )}
                  <button
                    type="button"
                    className={`button button--ghost ${styles.danger}`}
                    disabled={busy}
                    onClick={() => void remove(p.userId, p.displayName)}
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <>
          <span className={styles.subheading}>Add members</span>
          {full ? (
            <span className="muted">
              This group has reached the {MEMBERS_MAX}-member limit.
            </span>
          ) : (
            <input
              className="input"
              type="search"
              placeholder="Search by username"
              aria-label="Search users to add"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
          {!full && term.length > 0 && results.isPending && (
            <span className="muted">Searching…</span>
          )}
          {!full && term.length > 0 && results.isError && (
            <p className={styles.error} role="alert">
              Search failed. Please try again.
            </p>
          )}
          {!full &&
            results.isSuccess &&
            term.length > 0 &&
            candidates.length === 0 && (
              <span className="muted">No users to add.</span>
            )}
          {!full && term.length > 0 && (
            <ul className={styles.list}>
              {candidates.map((u) => (
                <li key={u.userId} className={styles.member}>
                  <span className={styles.memberText}>
                    <span className={styles.memberName}>{u.displayName}</span>
                    <span className={styles.memberMeta}>@{u.username}</span>
                  </span>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void add(u.userId)}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
