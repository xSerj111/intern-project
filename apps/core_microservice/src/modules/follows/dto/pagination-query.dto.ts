import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiProperty({ description: 'Number of followers shown' })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  limit?: number;

  @ApiProperty({ description: 'Actual page of followers' })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  page?: number;
}
