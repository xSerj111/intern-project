'use client';

import { useState } from 'react';

import { ConversationList } from '../../components/chat/conversation-list';
import { NewDirectChatDialog } from '../../components/chat/new-direct-chat-dialog';

import styles from './page.module.css';

export default function MessagesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className={`container ${styles.page}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>Messages</h1>
        <button
          type="button"
          className="button"
          onClick={() => setDialogOpen(true)}
        >
          New message
        </button>
      </div>

      <section aria-label="Conversations">
        <ConversationList />
      </section>

      {dialogOpen && (
        <NewDirectChatDialog onClose={() => setDialogOpen(false)} />
      )}
    </main>
  );
}
