/** Lifecycle status of a post. Mirrors the core service `PostStatus` enum. */
export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
  Archived = 'archived',
}

/** Compact author projection. `id` is the author's `authUserId`. */
export interface IAuthorSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Derived media kind, computed from the asset `mimeType`. */
export type MediaKind = 'image' | 'video';

/** A single media attachment, in display order. */
export interface IPostMediaResponse {
  assetId: string;
  /** Public S3/MinIO URL. */
  url: string;
  /** e.g. `image/jpeg`. */
  mimeType: string;
  /** Derived from `mimeType` (`image/*` → `image`, `video/*` → `video`). */
  mediaType: MediaKind;
  /** Ascending sort order. */
  displayOrder: number;
}

/** Which feed view to return from `GET /posts/feed`. */
export type FeedType = 'following' | 'discover';

/** Ordering applied to the feed. */
export type PostSort = 'newest' | 'oldest' | 'most_liked';

/** Optional media-type filter applied to the feed. */
export type MediaTypeFilter = 'photos' | 'videos' | 'text';

/** A single post as returned by the posts API. */
export interface IPostResponse {
  id: string;
  /** Author summary (replaces the raw `authorId`). */
  author: IAuthorSummary;
  content: string;
  status: PostStatus;
  /** Ordered media attachments; `mediaType` is derived from each `mimeType`. */
  assets: IPostMediaResponse[];
  likeCount: number;
  commentCount: number;
  repostCount: number;
  /** True when the authenticated viewer has liked the post; false when anonymous. */
  likedByMe: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A re-post feed item: an existing published post surfaced on the re-poster's
 * feed with attribution. `post` is `null` when the original is unavailable.
 */
export interface IRepostResponse {
  id: string;
  repostAuthor: IAuthorSummary;
  post: IPostResponse | null;
  createdAt: string;
}

/** A feed entry is either an original post or a re-post. Discriminate via `repostAuthor`. */
export type IFeedItem = IPostResponse | IRepostResponse;

/**
 * Paginated feed envelope returned by `GET /posts/feed`.
 *
 * Note: the feed uses `items`, not the `data` field of the generic
 * `IPaginatedResponse<T>`.
 */
export interface IFeedResponse {
  items: IFeedItem[];
  total: number;
  page: number;
  limit: number;
}

/** Paginated search envelope returned by `GET /posts/search`. */
export interface ISearchResponse {
  items: IPostResponse[];
  total: number;
  page: number;
  limit: number;
}
