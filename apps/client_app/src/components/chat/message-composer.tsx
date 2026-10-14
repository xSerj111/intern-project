'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { deleteMessage, editMessage, sendMessage } from '../../lib/api/chats';
import { getAccessToken } from '../../lib/auth/refresh';
import {
  addPendingMessage,
  applyEditedMessage,
  applySentMessage,
  removePendingMessage,
  setPendingMessageDelivery,
  type ChatMessage,
} from '../../lib/realtime/chat-cache';

import styles from './message-composer.module.css';
import { useTypingSignal } from './use-typing-signal';

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

/**
 * Edit and delete of the caller's own messages. An edit is applied to the cache
 * from the response; a delete turns into a tombstone via the `message:deleted`
 * event. Both reject on failure so the caller can show the error.
 */
export function useMessageActions(chatId: string) {
  const queryClient = useQueryClient();

  const edit = useCallback(
    async (message: ChatMessage, content: string) => {
      const updated = await editMessage(chatId, message.id, content, {
        token: getAccessToken(),
      });
      applyEditedMessage(queryClient, updated);
    },
    [chatId, queryClient],
  );

  const remove = useCallback(
    async (message: ChatMessage) => {
      await deleteMessage(chatId, message.id, { token: getAccessToken() });
    },
    [chatId],
  );

  return { edit, remove };
}

interface MessageComposerProps {
  chatId: string;
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function MessageComposer({
  chatId,
  onSend,
  disabled,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  // Clearing the text on send also emits `typing:stop`.
  const { stop } = useTypingSignal(chatId, text);
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
          onBlur={stop}
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
