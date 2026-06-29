import { ApiProperty } from '@nestjs/swagger';
import type { IProfileResponse } from '@repo/contracts';
import { UserProfile } from '../domain/entities/user-profile.entity';

/**
 * Response DTO for a profile. Built directly from the entity in its constructor:
 * serializes dates to ISO strings, normalizes optional columns to `null`, and
 * omits internal fields (e.g. `deletedAt`). Implements the shared
 * `IProfileResponse` contract so the wire shape stays decoupled from the schema.
 */
export class ProfileResponseDto implements IProfileResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  authUserId: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ type: String, nullable: true })
  bio: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(profile: UserProfile) {
    this.id = profile.id;
    this.authUserId = profile.authUserId;
    this.username = profile.username;
    this.displayName = profile.displayName;
    this.bio = profile.bio ?? null;
    this.avatarUrl = profile.avatarUrl ?? null;
    this.createdAt = profile.createdAt.toISOString();
    this.updatedAt = profile.updatedAt.toISOString();
  }
}
