import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import type { IRenameGroupRequest } from '@repo/contracts';

export class RenameGroupDto implements IRenameGroupRequest {
  @ApiProperty({ description: 'New group title (1-100 chars)', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  title!: string;
}
