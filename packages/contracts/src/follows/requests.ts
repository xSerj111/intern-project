export interface ICreateFollowRequest {
  followingId: string;
}

/** Query of `GET /follows/:userId/followers` and `/following`. */
export interface IFollowListQuery {
  /** Int ≥ 1, default 1. */
  page?: number;
  /** `1..50`, default 50. */
  limit?: number;
}
