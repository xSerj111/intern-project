import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ISearchProfilesQuery } from '@repo/contracts';

export class SearchProfilesQueryDto implements ISearchProfilesQuery {
  @ApiProperty({ description: 'Username prefix', minLength: 2, maxLength: 50 })
  @IsString()
  @Length(2, 50)
  q!: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 10;
}
