import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PAGE_SIZE_MAX, type IListChatsQuery } from '@repo/contracts';

export class ListChatsQueryDto implements IListChatsQuery {
  @ApiPropertyOptional({ description: 'ISO lastActivityAt cursor' })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  limit: number = 20;
}
