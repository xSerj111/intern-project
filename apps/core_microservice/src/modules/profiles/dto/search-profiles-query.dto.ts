import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PAGE_SIZE_MAX, type ISearchProfilesQuery } from '@repo/contracts';

export class SearchProfilesQueryDto implements ISearchProfilesQuery {
  @ApiProperty({
    description: 'Text the username or display name contains',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @Length(2, 50)
  q!: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  limit: number = 10;
}
