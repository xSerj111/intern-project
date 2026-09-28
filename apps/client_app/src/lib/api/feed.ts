import type {
  FeedType,
  IFeedResponse,
  MediaTypeFilter,
  PostSort,
} from '@repo/contracts';

import { coreApi } from './client';

export interface FeedParams {
  /** Feed view: `following` (default) or `discover`. */
  feed?: FeedType;
  /** Ordering: `newest` (default), `oldest`, or `most_liked`. */
  sort?: PostSort;
  /** Optional media filter. */
  mediaType?: MediaTypeFilter;
  page?: number;
  limit?: number;
  /** JWT for the personalized feed. */
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * Fetch the authenticated user's feed (`GET /posts/feed`). Following and
 * Discover are two views toggled via `feed`. The envelope uses `items`.
 */
export function getFeed({
  feed = 'following',
  sort = 'newest',
  mediaType,
  page = 1,
  limit = 20,
  token,
  signal,
}: FeedParams = {}): Promise<IFeedResponse> {
  return coreApi<IFeedResponse>('/posts/feed', {
    token,
    signal,
    query: { feed, sort, mediaType, page, limit },
  });
}
