import type { IAuthorSummary } from '../posts/responses';

/** A comment as returned by the comments API. */
export interface ICommentResponse {
  id: string;
  postId: string;
  /** Parent comment id for replies; `null` for top-level comments. */
  parentId: string | null;
  /** Author summary (replaces the raw `authorId`). */
  author: IAuthorSummary;
  content: string;
  createdAt: string;
  updatedAt: string;
}
