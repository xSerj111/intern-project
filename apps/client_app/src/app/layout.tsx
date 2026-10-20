import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { ToastHost } from '../components/notifications/toast-host';
import { AuthProvider } from '../lib/auth/auth-context';
import { QueryProvider } from '../lib/query/provider';
import { RealtimeProvider } from '../lib/realtime/realtime-provider';
import { ThemeProvider, themeInitScript } from '../lib/theme/theme-provider';

import './globals.css';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Innogram',
  description: 'Innogram — a social media application.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafb' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0e' },
  ],
};

/**
 * Providers shared by every route. The app chrome (sidebar, bottom bar) lives
 * in the `(app)` route group layout; `(auth)` pages render without it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The init script may set `data-theme` before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <QueryProvider>
              <RealtimeProvider>
                {children}
                <ToastHost />
              </RealtimeProvider>
            </QueryProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
