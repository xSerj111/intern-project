'use client';

import type { IChatParticipant } from '@repo/contracts';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { ChatMessage } from '../../lib/realtime/chat-cache';

import { MessageBubble } from './message-bubble';
import styles from './message-list.module.css';
import { SystemMessage } from './system-message';

const NEAR_BOTTOM_PX = 120;
const NEAR_TOP_PX = 80;

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string | undefined;
  /** Active participants, used to name the people in system lines. */
  participants?: readonly Pick<IChatParticipant, 'userId' | 'displayName'>[];
  hasMore: boolean;
  /** Load the page before the loaded window (`beforeSeq`). */
  onLoadOlder: () => Promise<void>;
  /** Re-send a failed message with its original `clientMessageId`. */
  onRetry: (message: ChatMessage) => void;
  onDiscard: (message: ChatMessage) => void;
  /** Save an edit of an own message; rejects on failure. */
  onEdit: (message: ChatMessage, content: string) => Promise<void>;
  /** Delete an own message; rejects on failure. */
  onDelete: (message: ChatMessage) => Promise<void>;
}

/** Messages in ascending `seq` (pending last); scrolling to the top loads older ones. */
export function MessageList({
  messages,
  currentUserId,
  participants,
  hasMore,
  onLoadOlder,
  onRetry,
  onDiscard,
  onEdit,
  onDelete,
}: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const prevHeightRef = useRef<number | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Names stay known after a member leaves, for the session's system lines.
  const namesRef = useRef(new Map<string, string>());
  for (const p of participants ?? []) {
    namesRef.current.set(p.userId, p.displayName);
  }
  const nameOf = useCallback(
    (userId: string) => namesRef.current.get(userId),
    [],
  );

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
            <SystemMessage
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              nameOf={nameOf}
            />
          );
        }
        return (
          <MessageBubble
            key={message.id}
            message={message}
            own={message.authorId === currentUserId}
            onRetry={onRetry}
            onDiscard={onDiscard}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}
