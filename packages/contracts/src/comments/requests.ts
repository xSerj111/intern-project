/** Query of `GET /comments/post/:postId`. Both fields count root comments. */
export interface IListCommentsQuery {
  /** Int ≥ 1, default 1. */
  page?: number;
  /** `1..50`, default 20. */
  limit?: number;
}
