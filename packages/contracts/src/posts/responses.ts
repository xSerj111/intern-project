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
}

/** A single post as returned by the posts API. */
export interface IPostResponse {
  id: string;
  authorId: string;
  content: string;
  status: PostStatus;
  assets?: IPostAssetResponse[];
  /** Likes with `deletedAt IS NULL`. */
  likeCount: number;
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
