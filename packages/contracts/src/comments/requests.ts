/** Body for `POST /comments`. */
export interface ICreateCommentRequest {
  /** Post UUID the comment belongs to. */
  postId: string;
  /** Non-empty; ≤ 300 chars. */
  content: string;
  /** Optional parent comment UUID (reply-to). */
  parentId?: string;
}

/** Body for `PATCH /comments/:id`. */
export interface IUpdateCommentRequest {
  /** ≤ 300 chars. */
  content?: string;
}
