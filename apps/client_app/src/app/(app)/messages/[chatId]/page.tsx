'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert, MessageCircleOff } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ChatHeader } from '../../../../components/chat/chat-header';
import { GroupMembersPanel } from '../../../../components/chat/group-members-panel';
import {
  MessageComposer,
  useMessageActions,
  useSendMessage,
} from '../../../../components/chat/message-composer';
import { MessageList } from '../../../../components/chat/message-list';
import { ThreadSkeleton } from '../../../../components/chat/thread-skeleton';
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
import { Button, buttonClassName } from '../../../../components/ui/button';
import { Dialog } from '../../../../components/ui/dialog';
import { EmptyState } from '../../../../components/ui/empty-state';

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
      <div className={styles.page}>
        <ThreadSkeleton />
      </div>
    );
  }

  if (detail.isError || messages.isError || !detail.data || !messages.data) {
    return (
      <div className={`${styles.page} ${styles.state}`}>
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this conversation"
          description="Check your connection and try again."
          action={
            <Button
              onClick={() => {
                void detail.refetch();
                void messages.refetch();
              }}
            >
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const chat = detail.data;
  const isGroup = chat.type === 'GROUP';

  return (
    <div className={styles.page}>
      <ChatHeader
        chat={chat}
        membersOpen={membersOpen}
        onToggleMembers={() => setMembersOpen((open) => !open)}
      />

      {isGroup && (
        <Dialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          title="Group members"
          description={chat.title ?? undefined}
          size="sm"
        >
          <GroupMembersPanel
            chat={chat}
            currentUserId={userId}
            onLeft={() => {
              setMembersOpen(false);
              queryClient.removeQueries({ queryKey: chatKeys.detail(chatId) });
              router.replace('/messages');
            }}
          />
        </Dialog>
      )}

      <MessageList
        messages={messages.data.items}
        currentUserId={userId}
        participants={chat.participants}
        isGroup={isGroup}
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
    <div className={`${styles.page} ${styles.state}`}>
      <EmptyState
        icon={MessageCircleOff}
        title="Conversation not found"
        description="This conversation doesn't exist or you aren't a participant."
        action={
          <Link href="/messages" className={buttonClassName({ variant: 'secondary' })}>
            Back to messages
          </Link>
        }
      />
    </div>
  );
}
