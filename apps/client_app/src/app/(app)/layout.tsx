import type { ReactNode } from 'react';

import { AppShell } from '../../components/shell/app-shell';

/** Signed-in app routes: wrapped in the sidebar / bottom-bar shell. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
