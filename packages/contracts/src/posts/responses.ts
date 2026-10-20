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
 * Paginated feed envelope returned by `GET /posts/feed`.
 *
 * Note: the feed uses `items`, not the `data` field of the generic
 * `IPaginatedResponse<T>`.
 */
export interface IFeedResponse {
  items: IPostResponse[];
  total: number;
  page: number;
  limit: number;
}
