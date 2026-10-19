'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { ConversationPane } from './conversation-pane';
import { MessagesDialogsProvider } from './messages-dialogs';
import styles from './messages-frame.module.css';

/**
 * Two-pane messages area. From tablet width the conversation list sits next to
 * the open thread; on phones only one of them shows, chosen by the route.
 */
export function MessagesFrame({ children }: { children: ReactNode }) {
  const params = useParams<{ chatId?: string }>();

  return (
    <MessagesDialogsProvider>
      <div className={styles.root}>
        <div className={styles.frame} data-view={params.chatId ? 'thread' : 'list'}>
          <ConversationPane />
          <div className={styles.thread}>{children}</div>
        </div>
      </div>
    </MessagesDialogsProvider>
  );
}
