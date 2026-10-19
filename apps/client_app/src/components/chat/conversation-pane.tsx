'use client';

import { Search, SquarePen, UsersRound } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { IconButton } from '../ui/button';

import { ConversationList } from './conversation-list';
import styles from './conversation-pane.module.css';
import { useMessagesDialogs } from './messages-dialogs';

/** Left column of the messages area: title, actions, filter and the list. */
export function ConversationPane() {
  const params = useParams<{ chatId?: string }>();
  const { openDirect, openGroup } = useMessagesDialogs();
  const [filter, setFilter] = useState('');
  // The thread owns the page's h1 when one is open.
  const Heading = params.chatId ? 'h2' : 'h1';

  return (
    <section className={styles.pane} aria-label="Conversations">
      <header className={styles.header}>
        <Heading className={styles.title}>Messages</Heading>
        <div className={styles.actions}>
          <IconButton label="New group" onClick={openGroup}>
            <UsersRound size={20} />
          </IconButton>
          <IconButton label="New message" onClick={openDirect}>
            <SquarePen size={20} />
          </IconButton>
        </div>
      </header>

      <div className={styles.search}>
        <Search size={16} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Filter conversations"
          aria-label="Filter conversations"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      <div className={styles.scroll}>
        <ConversationList filter={filter} />
      </div>
    </section>
  );
}
