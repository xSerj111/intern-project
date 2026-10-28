import type { IConversationDetail } from '@repo/contracts';
import { ChevronLeft, Users } from 'lucide-react';
import Link from 'next/link';

import { IconButton } from '../ui/button';

import { ChatAvatar } from './chat-avatar';
import { conversationTitle } from './chat-utils';
import styles from './chat-header.module.css';

interface ChatHeaderProps {
  chat: IConversationDetail;
  membersOpen: boolean;
  onToggleMembers: () => void;
}

/** Thread header: back (mobile), avatar + name, and the members toggle for groups. */
export function ChatHeader({
  chat,
  membersOpen,
  onToggleMembers,
}: ChatHeaderProps) {
  const title = conversationTitle(chat);
  const isGroup = chat.type === 'GROUP';
  const counterpart = chat.counterpart;

  const identity = (
    <>
      <ChatAvatar chat={chat} size="md" />
      <span className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.subtitle}>
          {isGroup
            ? `${chat.participants.length} members`
            : counterpart
              ? `@${counterpart.username}`
              : ''}
        </span>
      </span>
    </>
  );

  return (
    <header className={styles.header}>
      <Link
        href="/messages"
        className={styles.back}
        aria-label="Back to conversations"
      >
        <ChevronLeft size={24} aria-hidden="true" />
      </Link>

      {!isGroup && counterpart ? (
        <Link
          href={`/profile/${counterpart.userId}`}
          className={styles.identity}
          aria-label={`${title}, view profile`}
        >
          {identity}
        </Link>
      ) : (
        <div className={styles.identity}>{identity}</div>
      )}

      {isGroup && (
        <IconButton
          label={`Members (${chat.participants.length})`}
          aria-haspopup="dialog"
          aria-expanded={membersOpen}
          onClick={onToggleMembers}
        >
          <Users size={20} />
        </IconButton>
      )}
    </header>
  );
}
