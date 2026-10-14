'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import type { IConversationSummary } from '@repo/contracts';

import { useAuth } from '../../lib/auth/auth-context';
import {
  loadMoreConversations,
  useConversationList,
} from '../../lib/realtime/chat-cache';
import { ErrorState, LoadingState } from '../common/async-state';

import styles from './conversation-list.module.css';

function conversationTitle(chat: IConversationSummary): string {
  if (chat.type === 'GROUP') {
    return chat.title ?? 'Group chat';
  }
  return chat.counterpart?.displayName ?? 'Conversation';
}

function previewText(chat: IConversationSummary): string {
  const message = chat.lastMessage;
  if (!message) {
    return 'No messages yet';
  }
  if (message.deletedAt) {
    return 'Message deleted';
  }
  if (message.kind === 'SYSTEM') {
    return 'Group update';
  }
  if (message.content) {
    return message.content;
  }
  return message.attachments.length > 0 ? 'Attachment' : '';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Avatar({ chat, name }: { chat: IConversationSummary; name: string }) {
  const url = chat.type === 'DIRECT' ? chat.counterpart?.avatarUrl : null;
  if (url) {
    return <img className={styles.avatar} src={url} alt="" />;
  }
  return (
    <span className={styles.avatar} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** The signed-in user's conversations, newest activity first. */
export function ConversationList() {
  const { isHydrated } = useAuth();
  const queryClient = useQueryClient();
  const query = useConversationList();
  const [loadingMore, setLoadingMore] = useState(false);

  if (!isHydrated || query.isPending) {
    return <LoadingState label="Loading your conversations…" />;
  }

  if (query.isError) {
    return (
      <ErrorState
        message="We couldn't load your conversations."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { items, hasMore } = query.data;

  if (items.length === 0) {
    return (
      <p className={`muted ${styles.empty}`}>
        No conversations yet. Start one with “New message”.
      </p>
    );
  }

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await loadMoreConversations(queryClient);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <ul className={styles.list}>
        {items.map((chat) => {
          const name = conversationTitle(chat);
          return (
            <li key={chat.id}>
              <Link href={`/messages/${chat.id}`} className={styles.item}>
                <Avatar chat={chat} name={name} />
                <div className={styles.body}>
                  <div className={styles.row}>
                    <span className={styles.name}>{name}</span>
                    <time
                      className={styles.time}
                      dateTime={chat.lastActivityAt}
                    >
                      {formatTime(chat.lastActivityAt)}
                    </time>
                  </div>
                  <p className={styles.preview}>{previewText(chat)}</p>
                </div>
                {chat.unreadCount > 0 && (
                  <span
                    className={styles.badge}
                    aria-label={`${chat.unreadCount} unread`}
                  >
                    {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button
          type="button"
          className={`button button--ghost ${styles.more}`}
          disabled={loadingMore}
          onClick={() => void handleLoadMore()}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
