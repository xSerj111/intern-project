'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { NewDirectChatDialog } from './new-direct-chat-dialog';
import { NewGroupDialog } from './new-group-dialog';

interface MessagesDialogs {
  openDirect: () => void;
  openGroup: () => void;
}

const noop = () => undefined;
const MessagesDialogsContext = createContext<MessagesDialogs>({
  openDirect: noop,
  openGroup: noop,
});

/** Opens the new-message / new-group dialogs from anywhere in the messages area. */
export function useMessagesDialogs(): MessagesDialogs {
  return useContext(MessagesDialogsContext);
}

/** Owns the dialogs so the list header and the empty states can both open them. */
export function MessagesDialogsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<'direct' | 'group' | null>(null);
  const openDirect = useCallback(() => setDialog('direct'), []);
  const openGroup = useCallback(() => setDialog('group'), []);
  const close = useCallback(() => setDialog(null), []);
  const value = useMemo(
    () => ({ openDirect, openGroup }),
    [openDirect, openGroup],
  );

  return (
    <MessagesDialogsContext.Provider value={value}>
      {children}
      {dialog === 'direct' && <NewDirectChatDialog onClose={close} />}
      {dialog === 'group' && <NewGroupDialog onClose={close} />}
    </MessagesDialogsContext.Provider>
  );
}
