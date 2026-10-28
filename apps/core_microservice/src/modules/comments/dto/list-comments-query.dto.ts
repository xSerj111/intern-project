import { ApiPropertyOptional } from '@nestjs/swagger';
import { IListCommentsQuery, PAGE_SIZE_MAX } from '@repo/contracts';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query of `GET /comments/post/:postId`; both fields count root comments. */
export class ListCommentsQueryDto implements IListCommentsQuery {
  @ApiPropertyOptional({
    description: 'Page number (root comments)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Root comments per page',
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
}
