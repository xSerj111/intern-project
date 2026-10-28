import { ApiProperty } from '@nestjs/swagger';
import type { IChatUser } from '@repo/contracts';

/** Compact user card returned by profile search and the batch user lookup. */
export class ProfileUserResponseDto implements IChatUser {
  @ApiProperty({ description: 'Auth user id (JWT sub)' })
  userId!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;
}
