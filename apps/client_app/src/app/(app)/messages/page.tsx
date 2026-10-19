'use client';

import { useState } from 'react';

import { ConversationList } from '../../../components/chat/conversation-list';
import { NewDirectChatDialog } from '../../../components/chat/new-direct-chat-dialog';
import { NewGroupDialog } from '../../../components/chat/new-group-dialog';

import styles from './page.module.css';

export default function MessagesPage() {
  const [dialog, setDialog] = useState<'direct' | 'group' | null>(null);

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>Messages</h1>
        <div className={styles.actions}>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setDialog('group')}
          >
            New group
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setDialog('direct')}
          >
            New message
          </button>
        </div>
      </div>

      <section aria-label="Conversations">
        <ConversationList />
      </section>

      {dialog === 'direct' && (
        <NewDirectChatDialog onClose={() => setDialog(null)} />
      )}
      {dialog === 'group' && <NewGroupDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
