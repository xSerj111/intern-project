import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Header } from '../components/nav/header';
import { AuthProvider } from '../lib/auth/auth-context';
import { QueryProvider } from '../lib/query/provider';
import { RealtimeProvider } from '../lib/realtime/realtime-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Innogram',
  description: 'Innogram — a social media application.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <QueryProvider>
            <RealtimeProvider>
              <Header />
              {children}
            </RealtimeProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
