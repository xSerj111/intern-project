import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  CHANGES_PAGE_SIZE_MAX,
  type IMessageChangesQuery,
} from '@repo/contracts';

export class MessageChangesQueryDto implements IMessageChangesQuery {
  @ApiProperty({
    description: 'Catch-up cursor: last seen changeSeq',
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterChangeSeq!: number;

  @ApiPropertyOptional({
    default: 200,
    minimum: 1,
    maximum: CHANGES_PAGE_SIZE_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CHANGES_PAGE_SIZE_MAX)
  limit: number = 200;
}
