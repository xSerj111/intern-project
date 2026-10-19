import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import type { IMarkReadRequest } from '@repo/contracts';

export class MarkReadDto implements IMarkReadRequest {
  @ApiProperty({ description: 'Highest seq the user has read', minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seq!: number;
}
