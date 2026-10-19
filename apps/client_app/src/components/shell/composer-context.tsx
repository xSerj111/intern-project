'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { CreatePostDialog } from '../posts/create-post-dialog';

interface ComposerContextValue {
  /** Open the "Create new post" dialog. */
  openComposer: () => void;
}

const ComposerContext = createContext<ComposerContextValue | undefined>(
  undefined,
);

/** Owns the single post-composer dialog so any page can open it. */
export function ComposerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openComposer = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openComposer }), [openComposer]);

  return (
    <ComposerContext.Provider value={value}>
      {children}
      <CreatePostDialog open={open} onClose={() => setOpen(false)} />
    </ComposerContext.Provider>
  );
}

export function useComposer(): ComposerContextValue {
  const context = useContext(ComposerContext);
  if (!context) {
    throw new Error('useComposer must be used within a ComposerProvider');
  }
  return context;
}
