'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/** Interval between re-attempts once a query has entered an error state. */
const ERROR_REFETCH_INTERVAL_MS = 5000;

/**
 * Provides a configured TanStack Query client.
 *
 * `refetchInterval` re-attempts an errored query on an interval so the UI
 * automatically recovers once an unavailable backend responds again — no client
 * reload required (FR-007 / SC-005).
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            retryDelay: (attempt) =>
              Math.min(1000 * 2 ** attempt, ERROR_REFETCH_INTERVAL_MS),
            refetchInterval: (query) =>
              query.state.status === 'error'
                ? ERROR_REFETCH_INTERVAL_MS
                : false,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
