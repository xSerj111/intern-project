import type { FeedType, MediaTypeFilter, PostSort } from './responses';

/** Body for `POST /posts` — create a draft or publish immediately. */
export interface ICreatePostRequest {
  /** Optional; empty allowed for drafts. ≤ 500 chars. */
  content?: string;
  /** Optional ordered asset ids. ≤ 10. */
  assetIds?: string[];
  /** Optional; defaults to `false` (draft). Publishing requires non-empty content. */
  publish?: boolean;
}

/** Body for `PATCH /posts/:id` — edit text and/or replace all media. */
export interface IUpdatePostRequest {
  /** ≤ 500 chars. */
  content?: string;
  /** Replace-all ordered asset ids. ≤ 10. */
  assetIds?: string[];
}

/** Query params for `GET /posts/feed`. */
export interface IPostFeedQuery {
  /** Defaults to `following`. */
  feed?: FeedType;
  /** Defaults to `newest`. */
  sort?: PostSort;
  /** Absent = no filter. */
  mediaType?: MediaTypeFilter;
  page?: number;
  limit?: number;
}

/** Query params for `GET /posts/search`. */
export interface ISearchPostsQuery {
  /** Required; ≥ 3 chars. */
  keyword: string;
  page?: number;
  limit?: number;
}
