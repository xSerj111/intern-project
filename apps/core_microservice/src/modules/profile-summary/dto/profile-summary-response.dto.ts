import { ApiProperty } from '@nestjs/swagger';
import type { IProfileSummaryResponse } from '@repo/contracts';
import { ProfileResponseDto } from '../../profiles/dto/profile-response.dto';
import type { UserProfile } from '../../profiles/domain/entities/user-profile.entity';

/** Social counters shown next to a profile. */
export interface ProfileStats {
  followerCount: number;
  followingCount: number;
  postCount: number;
  isFollowedByMe: boolean;
}

export class ProfileSummaryResponseDto
  extends ProfileResponseDto
  implements IProfileSummaryResponse
{
  @ApiProperty()
  followerCount: number;

  @ApiProperty()
  followingCount: number;

  @ApiProperty({ description: 'Published posts only' })
  postCount: number;

  @ApiProperty({ description: "false for the requester's own profile" })
  isFollowedByMe: boolean;

  constructor(profile: UserProfile, stats: ProfileStats) {
    super(profile);
    this.followerCount = stats.followerCount;
    this.followingCount = stats.followingCount;
    this.postCount = stats.postCount;
    this.isFollowedByMe = stats.isFollowedByMe;
  }
}
