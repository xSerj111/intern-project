'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useSocket } from '../../lib/realtime/use-socket-event';

/** Minimum gap between `typing:start` emits while the user keeps typing. */
export const TYPING_START_INTERVAL_MS = 3000;

/**
 * Emit typing signals for the composer of one chat.
 *
 * While `value` is non-empty and changing, `typing:start` is sent at most once
 * every 3 s. `typing:stop` is sent when the value is cleared, when the
 * returned `stop` is called (wire it to the input's `onBlur`), when the chat
 * changes, and on unmount. Nothing is sent while the socket is absent.
 */
export function useTypingSignal(
  chatId: string,
  value: string,
): { stop: () => void } {
  const socket = useSocket();
  const lastStartRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (lastStartRef.current === null) {
      return;
    }
    lastStartRef.current = null;
    socket?.emit('typing:stop', { chatId });
  }, [socket, chatId]);

  const hasText = value.trim().length > 0;

  useEffect(() => {
    if (!socket) {
      return;
    }
    if (!hasText) {
      stop();
      return;
    }
    const now = Date.now();
    if (
      lastStartRef.current === null ||
      now - lastStartRef.current >= TYPING_START_INTERVAL_MS
    ) {
      lastStartRef.current = now;
      socket.emit('typing:start', { chatId });
    }
    // Re-run on every keystroke so renewals are sent while the user keeps typing.
  }, [socket, chatId, value, hasText, stop]);

  // Stop on unmount and whenever the chat or socket changes.
  useEffect(() => stop, [stop]);

  return { stop };
}
