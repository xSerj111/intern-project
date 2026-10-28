import { ApiProperty } from '@nestjs/swagger';
import type { IFollowListItem, IOffsetPage } from '@repo/contracts';
import { FollowResponseDto } from './follow-response.dto';

/** A follow edge in a followers/following list. Documentation shape only. */
export class FollowListItemResponseDto
  extends FollowResponseDto
  implements IFollowListItem
{
  @ApiProperty({ description: 'false for anonymous viewers' })
  isFollowedByMe!: boolean;
}

/** Offset page of follow edges. Documentation shape only. */
export class FollowPageResponseDto implements IOffsetPage<IFollowListItem> {
  @ApiProperty({ type: [FollowListItemResponseDto] })
  items!: FollowListItemResponseDto[];

  @ApiProperty({ description: 'Page number (1-based)' })
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  hasMore!: boolean;
}
