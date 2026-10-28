'use client';

import type { IChatUser } from '@repo/contracts';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState, type MouseEvent, type FocusEvent } from 'react';

import { cx } from '../../lib/cx';
import { formatClock, formatFullDate } from '../../lib/format/time';
import type { ChatMessage } from '../../lib/realtime/chat-cache';
import { isPendingMessage } from '../../lib/realtime/chat-cache';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { Menu, type MenuEntry } from '../ui/menu';
import { Textarea } from '../ui/input';

import { ConfirmDialog } from '../ui/confirm-dialog';
import { MessageAttachments } from './message-attachments';
import styles from './message-bubble.module.css';
import { MESSAGE_MAX_LENGTH } from './message-composer';

/** The message list marks its scroller with this attribute so popups can pick the side with room. */
const CHAT_SCROLLER_SELECTOR = '[data-chat-scroller]';

/** Menu height (two items plus padding) a popup needs above or below. */
const MENU_ROOM_PX = 120;

type Author = Pick<IChatUser, 'displayName' | 'avatarUrl'>;

interface MessageBubbleProps {
  /** A `USER` message (system rows are rendered by `SystemMessage`). */
  message: ChatMessage;
  own: boolean;
  /** Sender of someone else's message in a group chat (shows avatar and name). */
  author?: Author;
  /** The previous row is another bubble from the same sender. */
  joinPrev?: boolean;
  /** The next row is another bubble from the same sender. */
  joinNext?: boolean;
  onRetry: (message: ChatMessage) => void;
  onDiscard: (message: ChatMessage) => void;
  /** Save an edit; rejects on failure. */
  onEdit: (message: ChatMessage, content: string) => Promise<void>;
  /** Delete the message; rejects on failure. */
  onDelete: (message: ChatMessage) => Promise<void>;
}

/** One chat bubble with its meta line; own, stored messages get Edit and Delete. */
export function MessageBubble({
  message,
  own,
  author,
  joinPrev = false,
  joinNext = false,
  onRetry,
  onDiscard,
  onEdit,
  onDelete,
}: MessageBubbleProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<'top' | 'bottom'>('top');

  const pending = isPendingMessage(message);
  const failed = message.delivery === 'failed';
  const deleted = message.deletedAt !== null;
  const canAct = own && !pending && !deleted && message.kind === 'USER';
  const editing = canAct && mode === 'edit';
  const confirming = canAct && mode === 'confirmDelete';

  const startEdit = () => {
    setDraft(message.content ?? '');
    setError(null);
    setMode('edit');
  };

  const startDelete = () => {
    setError(null);
    setMode('confirmDelete');
  };

  const cancel = () => {
    setError(null);
    setMode('view');
  };

  const trimmed = draft.trim();
  const hasAttachments = message.attachments.length > 0;
  const unchanged = trimmed === (message.content ?? '');
  const canSave =
    !busy &&
    !unchanged &&
    draft.length <= MESSAGE_MAX_LENGTH &&
    (trimmed.length > 0 || hasAttachments);

  const save = async () => {
    if (!canSave) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onEdit(message, trimmed);
      setMode('view');
    } catch {
      setError('Could not save your changes. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete(message);
      setMode('view');
    } catch {
      setError('Could not delete the message. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // Open the popup toward the side of the scroller that has room for it.
  const choosePlacement = (
    event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
  ) => {
    const scroller = event.currentTarget.closest(CHAT_SCROLLER_SELECTOR);
    if (!scroller) {
      return;
    }
    const above =
      event.currentTarget.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
    setMenuPlacement(above > MENU_ROOM_PX ? 'top' : 'bottom');
  };

  const menuEntries: MenuEntry[] = [
    { label: 'Edit', icon: Pencil, onSelect: startEdit },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: startDelete },
  ];

  const attachments = !deleted && hasAttachments && (
    <MessageAttachments
      chatId={message.chatId}
      messageId={message.id}
      attachments={message.attachments}
      pending={pending}
    />
  );
  const text = deleted ? 'Message deleted' : message.content;
  const showMeta = !joinNext || pending || failed || Boolean(message.editedAt);

  return (
    <div
      data-testid="message-bubble"
      className={cx(
        styles.row,
        own && styles.rowOwn,
        !joinPrev && styles.groupStart,
      )}
    >
      {author && (
        <div className={styles.avatarSlot}>
          {!joinNext && (
            <Avatar
              src={author.avatarUrl}
              name={author.displayName}
              size="sm"
              decorative
            />
          )}
        </div>
      )}

      <div className={cx(styles.column, own && styles.columnOwn)}>
        {author && !joinPrev && (
          <span className={styles.author}>{author.displayName}</span>
        )}

        {editing ? (
          <div className={styles.editor}>
            <Textarea
              aria-label="Edit message"
              rows={2}
              autoFocus
              value={draft}
              disabled={busy}
              error={
                draft.length > MESSAGE_MAX_LENGTH
                  ? `At most ${MESSAGE_MAX_LENGTH} characters`
                  : undefined
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void save();
                } else if (event.key === 'Escape') {
                  cancel();
                }
              }}
            />
            <div className={styles.editorButtons}>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={cancel}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!canSave}
                loading={busy}
                onClick={() => void save()}
              >
                Save
              </Button>
            </div>
            {attachments}
          </div>
        ) : (
          <div className={cx(styles.bubbleLine, own && styles.bubbleLineOwn)}>
            <div className={cx(styles.content, own && styles.contentOwn)}>
              {(text || !attachments) && (
                <p
                  className={cx(
                    styles.bubble,
                    own ? styles.bubbleOwn : styles.bubbleOther,
                    joinPrev && styles.joinPrev,
                    joinNext && styles.joinNext,
                    deleted && styles.bubbleDeleted,
                    pending && !failed && styles.bubbleSending,
                    failed && styles.bubbleFailed,
                  )}
                  title={formatFullDate(message.createdAt)}
                >
                  {text}
                </p>
              )}
              {attachments}
            </div>
            {canAct && (
              <div
                className={styles.actions}
                onPointerDownCapture={choosePlacement}
                onFocusCapture={choosePlacement}
              >
                <Menu
                  label="Message actions"
                  triggerClassName={styles.menuTrigger}
                  trigger={<MoreHorizontal size={18} aria-hidden="true" />}
                  entries={menuEntries}
                  align={own ? 'end' : 'start'}
                  placement={menuPlacement}
                />
              </div>
            )}
          </div>
        )}

        {error && !confirming && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}

        {showMeta && (
          <div className={styles.meta}>
            {failed ? (
              <>
                <span className={styles.failed}>Failed to send</span>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onRetry(message)}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onDiscard(message)}
                >
                  Discard
                </button>
              </>
            ) : pending ? (
              <span>Sending…</span>
            ) : (
              <>
                <time dateTime={message.createdAt}>
                  {formatClock(message.createdAt)}
                </time>
                {message.editedAt && !deleted && (
                  <span title={formatFullDate(message.editedAt)}>edited</span>
                )}
                {own && !deleted && !joinNext && <span>Sent</span>}
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Delete this message?"
        description="It will be removed for everyone in this conversation."
        confirmLabel="Delete"
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void confirmDelete()}
        onCancel={cancel}
      />
    </div>
  );
}
