'use client';

import { MessageCircle } from 'lucide-react';

import { useMessagesDialogs } from '../../../components/chat/messages-dialogs';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';

import styles from './page.module.css';

/** Right pane when no conversation is open (hidden on phones, where the list shows). */
export default function MessagesPage() {
  const { openDirect } = useMessagesDialogs();

  return (
    <div className={styles.empty}>
      <EmptyState
        icon={MessageCircle}
        title="Select a conversation"
        description="Pick a chat from the list, or start a new one."
        action={<Button onClick={openDirect}>New message</Button>}
      />
    </div>
  );
}
