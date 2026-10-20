import type { ReactNode } from 'react';

import { MessagesFrame } from '../../../components/chat/messages-frame';

/** Conversation list on the left, the open thread (or a prompt) on the right. */
export default function MessagesLayout({ children }: { children: ReactNode }) {
  return <MessagesFrame>{children}</MessagesFrame>;
}
