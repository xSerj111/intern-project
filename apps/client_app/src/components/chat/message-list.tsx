'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { ChatMessage } from '../../lib/realtime/chat-cache';
import { isPendingMessage } from '../../lib/realtime/chat-cache';

import styles from './message-list.module.css';

const NEAR_BOTTOM_PX = 120;
const NEAR_TOP_PX = 80;

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

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string | undefined;
  hasMore: boolean;
  /** Load the page before the loaded window (`beforeSeq`). */
  onLoadOlder: () => Promise<void>;
  /** Re-send a failed message with its original `clientMessageId`. */
  onRetry: (message: ChatMessage) => void;
  onDiscard: (message: ChatMessage) => void;
}

/** Messages in ascending `seq` (pending last); scrolling to the top loads older ones. */
export function MessageList({
  messages,
  currentUserId,
  hasMore,
  onLoadOlder,
  onRetry,
  onDiscard,
}: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const prevHeightRef = useRef<number | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const loadOlder = useCallback(async () => {
    const el = scrollerRef.current;
    if (!el || loadingRef.current || !hasMore) {
      return;
    }
    loadingRef.current = true;
    setLoadingOlder(true);
    prevHeightRef.current = el.scrollHeight;
    try {
      await onLoadOlder();
    } catch {
      prevHeightRef.current = null;
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasMore, onLoadOlder]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    const lastId = messages.at(-1)?.id ?? null;
    if (prevHeightRef.current !== null) {
      // Older messages were prepended: keep the viewport on the same message.
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
      prevHeightRef.current = null;
    } else if (lastId !== lastIdRef.current) {
      const last = messages.at(-1);
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      if (
        lastIdRef.current === null ||
        nearBottom ||
        last?.authorId === currentUserId
      ) {
        el.scrollTop = el.scrollHeight;
      }
    }
    lastIdRef.current = lastId;
  }, [messages, currentUserId]);

  return (
    <div
      ref={scrollerRef}
      className={styles.scroller}
      aria-live="polite"
      onScroll={(event) => {
        if (event.currentTarget.scrollTop < NEAR_TOP_PX) {
          void loadOlder();
        }
      }}
    >
      {hasMore && (
        <button
          type="button"
          className={`button button--ghost ${styles.older}`}
          disabled={loadingOlder}
          onClick={() => void loadOlder()}
        >
          {loadingOlder ? 'Loading…' : 'Load older messages'}
        </button>
      )}

      {messages.length === 0 && (
        <p className={`muted ${styles.empty}`}>No messages yet. Say hello!</p>
      )}

      {messages.map((message) => {
        if (message.kind === 'SYSTEM') {
          return (
            <p key={message.id} className={styles.system}>
              Group update
            </p>
          );
        }
        const own = message.authorId === currentUserId;
        const pending = isPendingMessage(message);
        const failed = message.delivery === 'failed';
        const bubbleClass = [
          styles.bubble,
          own ? styles.bubbleOwn : '',
          pending && !failed ? styles.bubbleSending : '',
          failed ? styles.bubbleFailed : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={message.id}
            className={own ? `${styles.row} ${styles.rowOwn}` : styles.row}
          >
            <p className={bubbleClass}>
              {message.deletedAt
                ? 'Message deleted'
                : (message.content ??
                  (message.attachments.length > 0 ? 'Attachment' : ''))}
            </p>
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
                  {message.editedAt && !message.deletedAt && (
                    <span>edited</span>
                  )}
                  {own && <span>Sent</span>}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
