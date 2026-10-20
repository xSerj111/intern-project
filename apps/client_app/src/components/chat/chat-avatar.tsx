import type { IConversationSummary } from '@repo/contracts';
import { Users } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cx } from '../../lib/cx';
import { Avatar, AVATAR_SIZES, type AvatarSize } from '../ui/avatar';

import { conversationTitle } from './chat-utils';
import styles from './chat-avatar.module.css';

interface ChatAvatarProps {
  chat: Pick<IConversationSummary, 'type' | 'title' | 'counterpart'>;
  size?: AvatarSize;
  /** Decorative when the conversation name is shown next to it. */
  decorative?: boolean;
  className?: string;
}

/** Avatar of a conversation: the other person's picture, or a group glyph. */
export function ChatAvatar({
  chat,
  size = 'md',
  decorative = true,
  className,
}: ChatAvatarProps) {
  const name = conversationTitle(chat);

  if (chat.type === 'DIRECT') {
    return (
      <Avatar
        src={chat.counterpart?.avatarUrl}
        name={name}
        size={size}
        decorative={decorative}
        className={className}
      />
    );
  }

  const diameter = AVATAR_SIZES[size];
  return (
    <span
      className={cx(styles.group, className)}
      style={{ '--avatar-size': `${diameter}px` } as CSSProperties}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      <Users size={Math.round(diameter * 0.48)} aria-hidden="true" />
    </span>
  );
}
