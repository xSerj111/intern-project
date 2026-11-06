import type { PostStatus } from './responses';

/** Body of `POST /posts`. New posts start as drafts. */
export interface ICreatePostRequest {
  /** Up to 500 characters. */
  content: string;
  /** Up to 10 uploaded asset ids, in display order. */
  assetIds?: string[];
}

/** Body of `PATCH /posts/:id`. */
export interface IUpdatePostRequest {
  content: string;
}

/** Query of `GET /posts/author/:userId`. */
export interface IPostsByAuthorQuery {
  page?: number;
  limit?: number;
  /**
   * Defaults to `published`. Other statuses are only returned when the
   * requester is the author.
   */
  status?: PostStatus;
}

/** Query of `GET /posts/feed`. Cursor-based; `page` is not accepted. */
export interface IFeedQuery {
  /** Opaque value from a previous `nextCursor`. Omit for the first page. */
  cursor?: string;
  /** `1..50`, default 20. */
  limit?: number;
}

/** Query of `GET /hashtags/search`. */
export interface ISearchHashtagsQuery {
  /** Tag prefix, with or without a leading `#`. */
  q: string;
  /** `1..50`. */
  limit?: number;
}

/** Query of `GET /hashtags/:tag/posts`. Cursor-based, like the feed. */
export interface IHashtagFeedQuery {
  /** Opaque value from a previous `nextCursor`. Omit for the first page. */
  cursor?: string;
  /** `1..50`, default 20. */
  limit?: number;
}
