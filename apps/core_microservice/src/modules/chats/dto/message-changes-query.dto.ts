import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { IMessageChangesQuery } from '@repo/contracts';

export class MessageChangesQueryDto implements IMessageChangesQuery {
  @ApiProperty({
    description: 'Catch-up cursor: last seen changeSeq',
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterChangeSeq!: number;

  @ApiPropertyOptional({ default: 200, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}
