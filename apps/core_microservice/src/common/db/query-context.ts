import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';

interface QueryContext {
  queries: number;
}

const storage = new AsyncLocalStorage<QueryContext>();

/** Runs `fn` inside a fresh per-request query counter. */
export function runWithQueryContext<T>(fn: () => T): T {
  return storage.run({ queries: 0 }, fn);
}

/** Counts one DB round-trip for the current request; no-op outside a context. */
export function incrementQueryCount(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.queries += 1;
}

/** Queries counted so far in the current request, or undefined outside one. */
export function currentQueryCount(): number | undefined {
  return storage.getStore()?.queries;
}

/** Starts a query-count context for every HTTP request. */
@Injectable()
export class QueryContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    runWithQueryContext(() => next());
  }
}
