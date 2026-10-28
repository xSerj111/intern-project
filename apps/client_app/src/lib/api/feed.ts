import type { IFeedPage, IFeedQuery } from '@repo/contracts';

import { coreApi } from './client';

export interface FeedParams extends IFeedQuery {
  /** JWT for the personalized feed. */
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * Fetch one page of the authenticated user's personalized feed
 * (`GET /posts/feed`). Pass the previous page's `nextCursor` to continue;
 * omit it for the first page. Never sends `page` (the server rejects it).
 */
export function getFeed({
  cursor,
  limit = 20,
  token,
  signal,
}: FeedParams = {}): Promise<IFeedPage> {
  return coreApi<IFeedPage>('/posts/feed', {
    token,
    signal,
    query: { cursor, limit },
  });
}
