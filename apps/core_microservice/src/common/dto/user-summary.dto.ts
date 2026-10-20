import { ApiProperty } from '@nestjs/swagger';
import type { IChatUser, IUserSummary } from '@repo/contracts';

/** Minimal public identity of a user embedded in posts and comments. */
export class UserSummaryDto implements IUserSummary {
  @ApiProperty({ description: 'Auth user id (JWT sub)' })
  userId!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  /**
   * Builds the summary from a profile-shaped object (an entity or a directory
   * snapshot). `null` when the profile is missing.
   */
  static from(
    profile:
      | Pick<IChatUser, 'userId' | 'username' | 'displayName' | 'avatarUrl'>
      | undefined
      | null,
  ): UserSummaryDto | null {
    if (!profile) return null;
    const dto = new UserSummaryDto();
    dto.userId = profile.userId;
    dto.username = profile.username;
    dto.displayName = profile.displayName;
    dto.avatarUrl = profile.avatarUrl ?? null;
    return dto;
  }

  /** Builds the summary from a joined `UserProfile` (keyed by auth user id). */
  static fromProfile(
    profile:
      | {
          authUserId: string;
          username: string;
          displayName: string;
          avatarUrl?: string | null;
        }
      | undefined
      | null,
  ): UserSummaryDto | null {
    if (!profile) return null;
    return UserSummaryDto.from({
      userId: profile.authUserId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl ?? null,
    });
  }
}
