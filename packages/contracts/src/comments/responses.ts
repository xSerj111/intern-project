/** A single comment as returned by the comments API. */
export interface ICommentResponse {
  id: string;
  postId: string;
  /** Parent comment id for replies, `null` for top-level comments. */
  parentId: string | null;
  authorId: string;
  content: string;
  /** Likes with `deletedAt IS NULL`. */
  likeCount: number;
  /** `false` when the request is unauthenticated. */
  likedByMe: boolean;
  createdAt: string;
  updatedAt: string;
}
