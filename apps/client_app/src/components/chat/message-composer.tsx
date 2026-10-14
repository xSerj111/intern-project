'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { sendMessage } from '../../lib/api/chats';
import { getAccessToken } from '../../lib/auth/refresh';
import {
  addPendingMessage,
  applySentMessage,
  removePendingMessage,
  setPendingMessageDelivery,
  type ChatMessage,
} from '../../lib/realtime/chat-cache';

import styles from './message-composer.module.css';

export const MESSAGE_MAX_LENGTH = 2000;

/**
 * Optimistic send/retry/discard for one chat. A `clientMessageId` is generated
 * once per message and reused verbatim on retry (the server replays by it).
 */
export function useSendMessage(chatId: string, userId: string | undefined) {
  const queryClient = useQueryClient();

  const deliver = useCallback(
    async (clientMessageId: string, content: string) => {
      try {
        const message = await sendMessage(
          chatId,
          { clientMessageId, content },
          { token: getAccessToken() },
        );
        applySentMessage(queryClient, message);
      } catch {
        setPendingMessageDelivery(
          queryClient,
          chatId,
          clientMessageId,
          'failed',
        );
      }
    },
    [chatId, queryClient],
  );

  const send = useCallback(
    (content: string) => {
      if (!userId) {
        return;
      }
      const clientMessageId = crypto.randomUUID();
      addPendingMessage(queryClient, chatId, {
        clientMessageId,
        authorId: userId,
        content,
      });
      void deliver(clientMessageId, content);
    },
    [chatId, deliver, queryClient, userId],
  );

  const retry = useCallback(
    (message: ChatMessage) => {
      if (!message.clientMessageId || message.content === null) {
        return;
      }
      setPendingMessageDelivery(
        queryClient,
        chatId,
        message.clientMessageId,
        'sending',
      );
      void deliver(message.clientMessageId, message.content);
    },
    [chatId, deliver, queryClient],
  );

  const discard = useCallback(
    (message: ChatMessage) => {
      if (message.clientMessageId) {
        removePendingMessage(queryClient, chatId, message.clientMessageId);
      }
    },
    [chatId, queryClient],
  );

  return { send, retry, discard };
}

interface MessageComposerProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function MessageComposer({ onSend, disabled }: MessageComposerProps) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const tooLong = text.length > MESSAGE_MAX_LENGTH;
  const canSend = !disabled && trimmed.length > 0 && !tooLong;

  const submit = () => {
    if (!canSend) {
      return;
    }
    onSend(trimmed);
    setText('');
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.row}>
        <textarea
          className={`input ${styles.textarea}`}
          aria-label="Message"
          placeholder="Write a message…"
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="button" disabled={!canSend}>
          Send
        </button>
      </div>
      <span
        className={
          tooLong ? `${styles.counter} ${styles.counterOver}` : styles.counter
        }
      >
        {text.length}/{MESSAGE_MAX_LENGTH}
      </span>
    </form>
  );
}
