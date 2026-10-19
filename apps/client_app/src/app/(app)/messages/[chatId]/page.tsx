'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  ErrorState,
  LoadingState,
} from '../../../../components/common/async-state';
import { GroupMembersPanel } from '../../../../components/chat/group-members-panel';
import {
  MessageComposer,
  useMessageActions,
  useSendMessage,
} from '../../../../components/chat/message-composer';
import { MessageList } from '../../../../components/chat/message-list';
import { TypingIndicator } from '../../../../components/chat/typing-indicator';
import { chatKeys, getChat, markRead } from '../../../../lib/api/chats';
import { ApiError } from '../../../../lib/api/client';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  isPendingMessage,
  loadOlderMessages,
  useChatMessages,
  useConversationList,
} from '../../../../lib/realtime/chat-cache';
import { useSocket } from '../../../../lib/realtime/use-socket-event';

import styles from './page.module.css';

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export default function ChatPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId;
  const { accessToken, isHydrated, user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [membersOpen, setMembersOpen] = useState(false);
  const userId = user?.id;

  const detail = useQuery({
    queryKey: chatKeys.detail(chatId),
    queryFn: ({ signal }) => getChat(chatId, { token: accessToken, signal }),
    enabled: isHydrated && Boolean(accessToken),
    retry: (count, error) => !isNotFound(error) && count < 3,
  });
  const messages = useChatMessages(chatId);
  const list = useConversationList();
  const socket = useSocket();
  const { send, retry, discard } = useSendMessage(chatId, userId);
  const { edit, remove } = useMessageActions(chatId);

  // Tell the server which chat is on screen (suppresses `chat:alert` for it):
  // only while the tab is visible; cleared on route change, unmount and hide,
  // and re-sent on every (re)connect because a new socket starts with no value.
  useEffect(() => {
    if (!socket) {
      return;
    }
    const send = (viewing: string | null) => {
      if (socket.connected) {
        socket.emit('chat:view', { chatId: viewing }, () => undefined);
      }
    };
    const sendCurrent = () =>
      send(document.visibilityState === 'visible' ? chatId : null);
    sendCurrent();
    socket.on('connect', sendCurrent);
    document.addEventListener('visibilitychange', sendCurrent);
    return () => {
      socket.off('connect', sendCurrent);
      document.removeEventListener('visibilitychange', sendCurrent);
      send(null);
    };
  }, [socket, chatId]);

  // Highest server seq already reported as read from this page.
  const readSeqRef = useRef(0);
  const seededChatRef = useRef<string | null>(null);
  useEffect(() => {
    readSeqRef.current = 0;
    seededChatRef.current = null;
  }, [chatId]);

  const items = messages.data?.items;
  const summary = list.data?.items.find((c) => c.id === chatId);
  const unreadCount = summary?.unreadCount;

  useEffect(() => {
    if (!items || detail.isError) {
      return;
    }
    // Pending items carry seq 0 and are ignored.
    let highest = 0;
    for (const m of items) {
      if (!isPendingMessage(m) && m.seq > highest) {
        highest = m.seq;
      }
    }
    // First evaluation per chat: nothing unread means the pointer is current.
    if (seededChatRef.current !== chatId) {
      if (unreadCount === undefined) {
        return;
      }
      seededChatRef.current = chatId;
      if (unreadCount === 0) {
        readSeqRef.current = highest;
        return;
      }
    }
    const previous = readSeqRef.current;
    if (highest <= previous) {
      return;
    }
    readSeqRef.current = highest;
    // The server advances the sender's own pointer on send.
    const allOwn = items.every(
      (m) => isPendingMessage(m) || m.seq <= previous || m.authorId === userId,
    );
    if (allOwn) {
      return;
    }
    markRead(chatId, highest, { token: accessToken }).catch(() => {
      // Allow a later message (or reopen) to retry.
      readSeqRef.current = Math.min(readSeqRef.current, previous);
    });
  }, [items, unreadCount, chatId, accessToken, userId, detail.isError]);

  if (isNotFound(detail.error) || isNotFound(messages.error)) {
    return <NotFound />;
  }

  if (
    !isHydrated ||
    (!detail.isError &&
      !messages.isError &&
      (detail.isPending || messages.isPending))
  ) {
    return (
      <div className={`container ${styles.page}`}>
        <LoadingState label="Loading conversation…" />
      </div>
    );
  }

  if (detail.isError || messages.isError || !detail.data || !messages.data) {
    return (
      <div className={`container ${styles.page}`}>
        <ErrorState
          message="We couldn't load this conversation."
          onRetry={() => {
            void detail.refetch();
            void messages.refetch();
          }}
        />
      </div>
    );
  }

  const chat = detail.data;
  const title =
    chat.type === 'GROUP'
      ? (chat.title ?? 'Group chat')
      : (chat.counterpart?.displayName ?? 'Conversation');

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.header}>
        <Link href="/messages" className="button button--ghost">
          Back
        </Link>
        <h1 className={styles.title}>{title}</h1>
        {chat.type === 'GROUP' && (
          <button
            type="button"
            className={`button button--ghost ${styles.members}`}
            aria-expanded={membersOpen}
            onClick={() => setMembersOpen((open) => !open)}
          >
            Members ({chat.participants.length})
          </button>
        )}
      </div>

      {chat.type === 'GROUP' && membersOpen && (
        <GroupMembersPanel
          chat={chat}
          currentUserId={userId}
          onLeft={() => {
            queryClient.removeQueries({ queryKey: chatKeys.detail(chatId) });
            router.replace('/messages');
          }}
        />
      )}

      <MessageList
        messages={messages.data.items}
        currentUserId={userId}
        participants={chat.participants}
        hasMore={messages.data.hasMore}
        onLoadOlder={() => loadOlderMessages(queryClient, chatId)}
        onRetry={retry}
        onDiscard={discard}
        onEdit={edit}
        onDelete={remove}
      />

      <TypingIndicator chatId={chatId} />

      <MessageComposer chatId={chatId} onSend={send} />
    </div>
  );
}

function NotFound() {
  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Conversation not found</h1>
      <p className="muted">
        This conversation doesn&apos;t exist or you aren&apos;t a participant.
      </p>
      <Link href="/messages" className="button button--ghost">
        Back to messages
      </Link>
    </div>
  );
}
