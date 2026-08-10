import { FollowStatus } from '../enums/follow-status.enum';

export interface FollowProps {
  followerId: string;
  followingId: string;
  status?: FollowStatus;
}
