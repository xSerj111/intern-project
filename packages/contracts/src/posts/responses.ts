import type { IUserSummary } from '../common/responses';

/** Lifecycle status of a post. Mirrors the core service `PostStatus` enum. */
export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
  Archived = 'archived',
}

/** An asset attached to a post, in display order. */
export interface IPostAssetResponse {
  assetId: string;
  /** Ascending sort order. */
  displayOrder: number;
  /** Public URL of the asset; `null` if it is not publicly reachable. */
  url: string | null;
  mimeType: string;
}

/** A single post as returned by the posts API. */
export interface IPostResponse {
  id: string;
  authorId: string;
  /** Author's public identity; `null` if the profile no longer exists. */
  author: IUserSummary | null;
  content: string;
  status: PostStatus;
  assets?: IPostAssetResponse[];
  /** Likes with `deletedAt IS NULL`. */
  likeCount: number;
  /** Comments with `deletedAt IS NULL`. */
  commentCount: number;
  /** `false` when the request is unauthenticated. */
  likedByMe: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Cursor-paginated feed page returned by `GET /posts/feed`.
 */
export interface IFeedPage {
  items: IPostResponse[];
  /** `null` when there are no more items. */
  nextCursor: string | null;
}

/** One hashtag suggestion returned by `GET /posts/hashtags/search`. */
export interface IHashtagResult {
  /** Normalized tag, without `#`. */
  tag: string;
  /** Number of published posts carrying the tag. */
  postCount: number;
}

/** Offset page returned by `GET /posts/search`. */
export interface IPostSearchPage {
  items: IPostResponse[];
  /** Total number of matching posts. */
  total: number;
  page: number;
  limit: number;
}
