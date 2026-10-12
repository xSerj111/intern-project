import type { IFeedResponse } from '@repo/contracts';

import { coreApi } from './client';

export interface FeedParams {
  page?: number;
  limit?: number;
  /** JWT for the personalized feed. */
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * Fetch the authenticated user's personalized feed (`GET /posts/feed`).
 * The envelope uses `items` (not `data`).
 */
export function getFeed({
  page = 1,
  limit = 20,
  token,
  signal,
}: FeedParams = {}): Promise<IFeedResponse> {
  return coreApi<IFeedResponse>('/posts/feed', {
    token,
    signal,
    query: { page, limit },
  });
}
