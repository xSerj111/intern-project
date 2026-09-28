import type { ISearchResponse } from '@repo/contracts';

import { coreApi } from './client';

export interface SearchParams {
  /** Keyword to match against post content (server enforces ≥3 chars). */
  keyword: string;
  page?: number;
  limit?: number;
  /** Optional JWT (the endpoint is public but this keeps like state consistent). */
  token?: string | null;
  signal?: AbortSignal;
}

/** Search published posts via `GET /posts/search` (FR-020/021/022). */
export function searchPosts({
  keyword,
  page = 1,
  limit = 20,
  token,
  signal,
}: SearchParams): Promise<ISearchResponse> {
  return coreApi<ISearchResponse>('/posts/search', {
    token,
    signal,
    query: { keyword, page, limit },
  });
}
