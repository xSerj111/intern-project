export interface IFollowResponse {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

/** A follow edge in a followers/following list. */
export interface IFollowListItem extends IFollowResponse {
  /** `false` for anonymous viewers. */
  isFollowedByMe: boolean;
}
