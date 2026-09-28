import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type { FeedType, MediaTypeFilter, PostSort } from '@repo/contracts';

export class FeedQueryDto {
  @ApiPropertyOptional({
    description: 'Which feed view to return',
    enum: ['following', 'discover'],
    default: 'following',
  })
  @IsOptional()
  @IsIn(['following', 'discover'])
  feed: FeedType = 'following';

  @ApiPropertyOptional({
    description: 'Feed ordering',
    enum: ['newest', 'oldest', 'most_liked'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'most_liked'])
  sort: PostSort = 'newest';

  @ApiPropertyOptional({
    description: 'Optional media-type filter',
    enum: ['photos', 'videos', 'text'],
  })
  @IsOptional()
  @IsIn(['photos', 'videos', 'text'])
  mediaType?: MediaTypeFilter;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Number of posts per page',
    default: 20,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;
}
