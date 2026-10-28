import type {
  IFeedPage,
  IHashtagFeedQuery,
  IHashtagResult,
  IPostSearchPage,
  ISearchHashtagsQuery,
} from '@repo/contracts';

import { coreApi } from './client';
import { postKeys } from './posts';

/**
 * TanStack Query key factories for search. People search reuses
 * `searchProfiles()` from `./profile`; only its key lives here.
 */
export const searchKeys = {
  all: ['search'] as const,
  people: (q: string) => [...searchKeys.all, 'people', q] as const,
  posts: (q: string) => [...searchKeys.all, 'posts', q] as const,
  tags: (q: string) => [...searchKeys.all, 'tags', q] as const,
  /** Under `postKeys.all`, so post mutations that invalidate posts refetch it. */
  tagFeed: (tag: string) => [...postKeys.all, 'tag-feed', tag] as const,
};

/** Query of `GET /posts/search`; `keyword` needs at least 3 characters. */
export interface SearchPostsQuery {
  keyword: string;
  /** 1-based, default 1. */
  page?: number;
  /** `1..50`, default 20. */
  limit?: number;
}

/** Search published posts by content keyword (`GET /posts/search`). */
export function searchPosts(
  { keyword, page, limit }: SearchPostsQuery,
  token?: string | null,
  signal?: AbortSignal,
): Promise<IPostSearchPage> {
  return coreApi<IPostSearchPage>('/posts/search', {
    token,
    signal,
    query: { keyword, page, limit },
  });
}

/** Hashtag prefix suggestions (`GET /hashtags/search`). */
export function searchHashtags(
  { q, limit }: ISearchHashtagsQuery,
  token?: string | null,
  signal?: AbortSignal,
): Promise<IHashtagResult[]> {
  return coreApi<IHashtagResult[]>('/hashtags/search', {
    token,
    signal,
    query: { q, limit },
  });
}

/**
 * One page of posts carrying a hashtag (`GET /hashtags/:tag/posts`). Pass the
 * previous page's `nextCursor` to continue; `tag` is given without `#`.
 */
export function getHashtagFeed(
  tag: string,
  { cursor, limit }: IHashtagFeedQuery = {},
  token?: string | null,
  signal?: AbortSignal,
): Promise<IFeedPage> {
  return coreApi<IFeedPage>(`/hashtags/${encodeURIComponent(tag)}/posts`, {
    token,
    signal,
    query: { cursor, limit },
  });
}
