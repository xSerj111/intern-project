'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, SearchX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import {
  loadMoreConversations,
  useConversationList,
} from '../../lib/realtime/chat-cache';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { RelativeTime } from '../ui/relative-time';
import { RowSkeleton, SkeletonGroup } from '../ui/skeleton';

import { ChatAvatar } from './chat-avatar';
import { conversationTitle, previewText } from './chat-utils';
import styles from './conversation-list.module.css';
import { useMessagesDialogs } from './messages-dialogs';

interface ConversationListProps {
  /** Case-insensitive text matched against names and previews. */
  filter?: string;
}

/** The signed-in user's conversations, newest activity first. */
export function ConversationList({ filter = '' }: ConversationListProps) {
  const { isHydrated, user } = useAuth();
  const queryClient = useQueryClient();
  const query = useConversationList();
  const params = useParams<{ chatId?: string }>();
  const { openDirect } = useMessagesDialogs();
  const [loadingMore, setLoadingMore] = useState(false);

  if (!isHydrated || query.isPending) {
    return (
      <SkeletonGroup label="Loading your conversations…" className={styles.skeleton}>
        <RowSkeleton count={6} />
      </SkeletonGroup>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Couldn't load conversations"
        description="Check your connection and try again."
        action={<Button onClick={() => void query.refetch()}>Try again</Button>}
      />
    );
  }

  const { items, hasMore } = query.data;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="No conversations yet"
        description="Start one with someone you follow."
        action={<Button onClick={openDirect}>New message</Button>}
      />
    );
  }

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? items.filter(
        (chat) =>
          conversationTitle(chat).toLowerCase().includes(needle) ||
          previewText(chat).toLowerCase().includes(needle),
      )
    : items;

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
      {visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No matches"
          description={
            hasMore
              ? `Nothing loaded matches “${filter.trim()}”. Load more conversations to search further.`
              : `No conversation matches “${filter.trim()}”.`
          }
        />
      ) : (
        <ul className={styles.list}>
          {visible.map((chat) => {
            const name = conversationTitle(chat);
            const active = chat.id === params.chatId;
            const unread = chat.unreadCount > 0;
            return (
              <li key={chat.id}>
                <Link
                  href={`/messages/${chat.id}`}
                  className={cx(
                    styles.item,
                    active && styles.active,
                    unread && styles.unread,
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <ChatAvatar chat={chat} size="md" />
                  <div className={styles.body}>
                    <div className={styles.row}>
                      <span className={styles.name}>{name}</span>
                      <RelativeTime
                        value={chat.lastActivityAt}
                        className={styles.time}
                      />
                    </div>
                    <div className={styles.row}>
                      <span className={styles.preview}>
                        {previewText(chat, user?.id)}
                      </span>
                      <Badge
                        count={chat.unreadCount}
                        variant="primary"
                        label={`${chat.unreadCount} unread`}
                      />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className={styles.more}>
          <Button
            variant="ghost"
            size="sm"
            loading={loadingMore}
            onClick={() => void handleLoadMore()}
          >
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
