'use client';

import { useEffect, useRef, useState } from 'react';

import type { ChatMessage } from '../../lib/realtime/chat-cache';
import { isPendingMessage } from '../../lib/realtime/chat-cache';

import styles from './message-bubble.module.css';
import { MessageAttachments } from './message-attachments';
import { MESSAGE_MAX_LENGTH } from './message-composer';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface MessageBubbleProps {
  /** A `USER` message (system rows are rendered by `SystemMessage`). */
  message: ChatMessage;
  own: boolean;
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
  onRetry,
  onDiscard,
  onEdit,
  onDelete,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const pending = isPendingMessage(message);
  const failed = message.delivery === 'failed';
  const deleted = message.deletedAt !== null;
  const canAct = own && !pending && !deleted && message.kind === 'USER';
  const editing = canAct && mode === 'edit';
  const confirming = canAct && mode === 'confirmDelete';

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const startEdit = () => {
    setDraft(message.content ?? '');
    setError(null);
    setMenuOpen(false);
    setMode('edit');
  };

  const startDelete = () => {
    setError(null);
    setMenuOpen(false);
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

  const attachments = !deleted && hasAttachments && (
    <MessageAttachments
      chatId={message.chatId}
      messageId={message.id}
      attachments={message.attachments}
      pending={pending}
    />
  );
  const text = deleted ? 'Message deleted' : message.content;

  const bubbleClass = [
    styles.bubble,
    own ? styles.bubbleOwn : '',
    deleted ? styles.bubbleDeleted : '',
    pending && !failed ? styles.bubbleSending : '',
    failed ? styles.bubbleFailed : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={own ? `${styles.row} ${styles.rowOwn}` : styles.row}>
      {editing ? (
        <div className={styles.editor}>
          <textarea
            className={`input ${styles.editorTextarea}`}
            aria-label="Edit message"
            rows={2}
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void save();
              } else if (event.key === 'Escape') {
                cancel();
              }
            }}
          />
          <div className={styles.editorButtons}>
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button"
              disabled={!canSave}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
          {attachments}
        </div>
      ) : (
        <div className={styles.bubbleLine}>
          <div className={styles.content}>
            {(text || !attachments) && <p className={bubbleClass}>{text}</p>}
            {attachments}
          </div>
          {canAct && !confirming && (
            <div className={styles.actions} ref={actionsRef}>
              <button
                type="button"
                className={styles.menuButton}
                aria-label="Message actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setMenuOpen(false);
                  }
                }}
              >
                &#8943;
              </button>
              {menuOpen && (
                <div className={styles.menu} role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={startEdit}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`${styles.menuItem} ${styles.menuItemDanger}`}
                    onClick={startDelete}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {confirming && (
        <div
          className={styles.meta}
          role="alertdialog"
          aria-label="Delete message"
        >
          <span>Delete this message?</span>
          <button
            type="button"
            className={`${styles.linkButton} ${styles.failed}`}
            disabled={busy}
            onClick={() => void confirmDelete()}
          >
            Delete
          </button>
          <button
            type="button"
            className={styles.linkButton}
            disabled={busy}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}

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
              {formatTime(message.createdAt)}
            </time>
            {message.editedAt && !deleted && (
              <span>edited · {formatTime(message.editedAt)}</span>
            )}
            {own && !deleted && <span>Sent</span>}
          </>
        )}
      </div>
    </div>
  );
}
