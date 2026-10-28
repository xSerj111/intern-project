'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
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
import { Avatar } from '../ui/avatar';
import { Button, IconButton } from '../ui/button';
import { Input } from '../ui/input';
import { Spinner } from '../ui/spinner';

import { ConfirmDialog } from '../ui/confirm-dialog';
import styles from './group-members-panel.module.css';

const TITLE_MAX = 100;
const MEMBERS_MAX = 100;

interface GroupMembersPanelProps {
  chat: IConversationDetail;
  currentUserId?: string;
  /** Called after the current user has left the group. */
  onLeft: () => void;
}

type Confirmation =
  | { kind: 'leave' }
  | { kind: 'remove'; userId: string; name: string };

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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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
    report: (message: string | null) => void = setError,
  ) => {
    setBusy(true);
    report(null);
    try {
      const updated = await action();
      if (updated) {
        queryClient.setQueryData(chatKeys.detail(chat.id), updated);
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      return true;
    } catch {
      report(failure);
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

  const closeConfirmation = () => {
    setConfirmation(null);
    setConfirmError(null);
  };

  const confirm = async () => {
    if (!confirmation) {
      return;
    }
    if (confirmation.kind === 'leave') {
      const ok = await run(
        async () => {
          await leaveChat(chat.id, { token: accessToken });
        },
        'Could not leave the group.',
        setConfirmError,
      );
      if (ok) {
        closeConfirmation();
        onLeft();
      }
      return;
    }
    const { userId } = confirmation;
    const ok = await run(
      async () => {
        await removeMember(chat.id, userId, { token: accessToken });
        await queryClient.invalidateQueries({
          queryKey: chatKeys.detail(chat.id),
        });
      },
      'Could not remove that member.',
      setConfirmError,
    );
    if (ok) {
      closeConfirmation();
    }
  };

  return (
    <section className={styles.panel} aria-label="Group members">
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
          <div className={styles.grow}>
            <Input
              label="Group name"
              maxLength={TITLE_MAX}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!canRename || busy}>
            Rename
          </Button>
        </form>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div>
        <h3 className={styles.subheading}>
          {chat.participants.length} members
        </h3>
        <ul className={styles.list}>
          {chat.participants.map((p) => {
            const isSelf = p.userId === currentUserId;
            return (
              <li key={p.userId} className={styles.member}>
                <Avatar src={p.avatarUrl} name={p.displayName} size="sm" decorative />
                <span className={styles.memberText}>
                  <span className={styles.memberName}>
                    {p.displayName}
                    {isSelf ? ' (you)' : ''}
                  </span>
                  <span className={styles.memberMeta}>@{p.username}</span>
                </span>
                {p.role === 'ADMIN' && (
                  <span className={styles.role}>Admin</span>
                )}
                {isAdmin && !isSelf && (
                  <span className={styles.actions}>
                    {p.role !== 'ADMIN' && (
                      <IconButton
                        label={`Make ${p.displayName} an admin`}
                        size="sm"
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
                        <ShieldCheck size={18} />
                      </IconButton>
                    )}
                    <IconButton
                      label={`Remove ${p.displayName} from the group`}
                      size="sm"
                      className={styles.dangerIcon}
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          kind: 'remove',
                          userId: p.userId,
                          name: p.displayName,
                        })
                      }
                    >
                      <UserMinus size={18} />
                    </IconButton>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {isAdmin && (
        <div className={styles.add}>
          <h3 className={styles.subheading}>Add members</h3>
          {full ? (
            <p className={styles.status}>
              This group has reached the {MEMBERS_MAX}-member limit.
            </p>
          ) : (
            <Input
              type="search"
              placeholder="Search by username"
              aria-label="Search users to add"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
          {!full && term.length > 0 && results.isPending && (
            <p className={styles.status} role="status">
              <Spinner size={14} /> Searching…
            </p>
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
              <p className={styles.status}>No users to add.</p>
            )}
          {!full && term.length > 0 && (
            <ul className={styles.list}>
              {candidates.map((u) => (
                <li key={u.userId} className={styles.member}>
                  <Avatar src={u.avatarUrl} name={u.displayName} size="sm" decorative />
                  <span className={styles.memberText}>
                    <span className={styles.memberName}>{u.displayName}</span>
                    <span className={styles.memberMeta}>@{u.username}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<UserPlus size={16} />}
                    disabled={busy}
                    onClick={() => void add(u.userId)}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button
        variant="secondary"
        className={styles.leave}
        icon={<LogOut size={16} />}
        disabled={busy}
        onClick={() => setConfirmation({ kind: 'leave' })}
      >
        Leave group
      </Button>

      <ConfirmDialog
        open={confirmation !== null}
        title={
          confirmation?.kind === 'remove'
            ? `Remove ${confirmation.name}?`
            : 'Leave this group?'
        }
        description={
          confirmation?.kind === 'remove'
            ? 'They will no longer see new messages in this group.'
            : 'You will stop receiving messages from this group.'
        }
        confirmLabel={confirmation?.kind === 'remove' ? 'Remove' : 'Leave'}
        destructive
        busy={busy}
        error={confirmError}
        onConfirm={() => void confirm()}
        onCancel={closeConfirmation}
      />
    </section>
  );
}
