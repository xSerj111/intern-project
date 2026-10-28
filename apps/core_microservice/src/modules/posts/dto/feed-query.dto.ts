import { ApiPropertyOptional } from '@nestjs/swagger';
import { PAGE_SIZE_MAX, type IFeedQuery } from '@repo/contracts';
import { Type } from 'class-transformer';
import { Equals, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsFeedCursor } from './is-feed-cursor.validator';

export class FeedQueryDto implements IFeedQuery {
  @ApiPropertyOptional({
    description:
      'Opaque cursor from a previous `nextCursor`. Omit for the first page.',
  })
  @IsOptional()
  @IsFeedCursor()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of posts per page',
    default: 20,
    minimum: 1,
    maximum: PAGE_SIZE_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  limit: number = 20;

  /**
   * Declared only so `whitelist` keeps it and validation can reject it.
   * Any supplied value (including an empty one) is a 400.
   */
  @Equals(undefined, { message: 'page is not supported; use cursor' })
  page?: unknown;
}
