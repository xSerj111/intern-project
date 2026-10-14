'use client';

import type { IChatUser } from '@repo/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSocketEvent } from '../../lib/realtime/use-socket-event';

import styles from './typing-indicator.module.css';

/** A typing entry expires after this long without a renewal (FR-019). */
export const TYPING_EXPIRY_MS = 5000;

/**
 * Users currently typing in `chatId`, keyed by `userId`. Each entry is dropped
 * after 5 s without renewal, on `typing { isTyping: false }`, or when that
 * user's `message:new` arrives. Nothing is persisted (FR-020).
 */
export function useTypingUsers(chatId: string): IChatUser[] {
  const [users, setUsers] = useState<IChatUser[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const drop = useCallback((userId: string) => {
    const timer = timersRef.current.get(userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(userId);
    }
    setUsers((prev) =>
      prev.some((u) => u.userId === userId)
        ? prev.filter((u) => u.userId !== userId)
        : prev,
    );
  }, []);

  // Reset when switching chats and clear timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      setUsers([]);
    };
  }, [chatId]);

  useSocketEvent('typing', (payload) => {
    if (payload.chatId !== chatId) {
      return;
    }
    const { user, isTyping } = payload;
    if (!isTyping) {
      drop(user.userId);
      return;
    }
    const existing = timersRef.current.get(user.userId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    timersRef.current.set(
      user.userId,
      setTimeout(() => drop(user.userId), TYPING_EXPIRY_MS),
    );
    setUsers((prev) =>
      prev.some((u) => u.userId === user.userId)
        ? prev.map((u) => (u.userId === user.userId ? user : u))
        : [...prev, user],
    );
  });

  useSocketEvent('message:new', ({ message }) => {
    if (message.chatId === chatId) {
      drop(message.authorId);
    }
  });

  return users;
}

/** Human text for the typing users, or `null` when nobody is typing. */
export function formatTypingText(users: IChatUser[]): string | null {
  if (users.length === 0) {
    return null;
  }
  if (users.length === 1) {
    return `${users[0].displayName} is typing…`;
  }
  if (users.length === 2) {
    return `${users[0].displayName} and ${users[1].displayName} are typing…`;
  }
  return 'several people are typing';
}

/** "Anna is typing…" line for a chat. Reserves its height so the layout doesn't jump. */
export function TypingIndicator({ chatId }: { chatId: string }) {
  const text = formatTypingText(useTypingUsers(chatId));
  return (
    <div className={styles.typing} role="status" aria-live="polite">
      {text}
    </div>
  );
}
