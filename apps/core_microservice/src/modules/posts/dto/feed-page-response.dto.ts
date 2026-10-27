import { ApiProperty } from '@nestjs/swagger';
import type { IFeedPage } from '@repo/contracts';
import { PostResponseDto } from './post-response.dto';

/** Documentation shape of `GET /posts/feed` (cursor page). */
export class FeedPageResponseDto implements IFeedPage {
  @ApiProperty({ type: [PostResponseDto] })
  items!: PostResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass as `cursor` for the next page; null when there are no more items',
  })
  nextCursor!: string | null;
}
