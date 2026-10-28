'use client';

import type { IChatUser } from '@repo/contracts';
import { MessageCircle } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { formatDayLabel, isSameDay } from '../../lib/format/time';
import type { ChatMessage } from '../../lib/realtime/chat-cache';
import { Button } from '../ui/button';

import { MessageBubble } from './message-bubble';
import styles from './message-list.module.css';
import { SystemMessage } from './system-message';

const NEAR_BOTTOM_PX = 120;
const NEAR_TOP_PX = 80;
/** Bubbles from one sender further apart than this start a new group. */
const GROUP_GAP_MS = 10 * 60_000;

type Person = Pick<IChatUser, 'userId' | 'displayName' | 'avatarUrl'>;

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string | undefined;
  /** Active participants: names for system lines, avatars for group bubbles. */
  participants?: readonly Person[];
  /** Group chat: others' bubbles show the sender's avatar and name. */
  isGroup?: boolean;
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

/** True when `next` continues the bubble group that `prev` belongs to. */
function continuesGroup(
  prev: ChatMessage | undefined,
  next: ChatMessage | undefined,
): boolean {
  if (!prev || !next || prev.kind !== 'USER' || next.kind !== 'USER') {
    return false;
  }
  return (
    prev.authorId === next.authorId &&
    isSameDay(prev.createdAt, next.createdAt) &&
    Math.abs(Date.parse(next.createdAt) - Date.parse(prev.createdAt)) <
      GROUP_GAP_MS
  );
}

/** Messages in ascending `seq` (pending last); scrolling to the top loads older ones. */
export function MessageList({
  messages,
  currentUserId,
  participants,
  isGroup = false,
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
  // People stay known after they leave, for the session's bubbles and system lines.
  const peopleRef = useRef(new Map<string, Person>());
  for (const p of participants ?? []) {
    peopleRef.current.set(p.userId, p);
  }
  const nameOf = useCallback(
    (userId: string) => peopleRef.current.get(userId)?.displayName,
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
      data-chat-scroller=""
      role="log"
      aria-label="Messages"
      aria-live="polite"
      onScroll={(event) => {
        if (event.currentTarget.scrollTop < NEAR_TOP_PX) {
          void loadOlder();
        }
      }}
    >
      <div className={styles.inner}>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.older}
            loading={loadingOlder}
            onClick={() => void loadOlder()}
          >
            Load older messages
          </Button>
        )}

        {messages.length === 0 && (
          <div className={styles.empty}>
            <MessageCircle size={32} strokeWidth={1.5} aria-hidden="true" />
            <p>No messages yet. Say hello!</p>
          </div>
        )}

        {messages.map((message, index) => {
          const prev = messages[index - 1];
          const next = messages[index + 1];
          const startsDay =
            !prev || !isSameDay(prev.createdAt, message.createdAt);

          let row;
          if (message.kind === 'SYSTEM') {
            row = (
              <SystemMessage
                message={message}
                currentUserId={currentUserId}
                nameOf={nameOf}
              />
            );
          } else {
            const own = message.authorId === currentUserId;
            const sender = peopleRef.current.get(message.authorId);
            row = (
              <MessageBubble
                message={message}
                own={own}
                author={
                  isGroup && !own
                    ? (sender ?? { displayName: 'Someone', avatarUrl: null })
                    : undefined
                }
                joinPrev={!startsDay && continuesGroup(prev, message)}
                joinNext={continuesGroup(message, next)}
                onRetry={onRetry}
                onDiscard={onDiscard}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            );
          }

          return (
            <Fragment key={message.id}>
              {startsDay && (
                <div className={styles.day}>
                  <span>{formatDayLabel(message.createdAt)}</span>
                </div>
              )}
              {row}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
