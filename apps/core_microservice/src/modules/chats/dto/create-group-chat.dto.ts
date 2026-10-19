import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import type { ICreateGroupChatRequest } from '@repo/contracts';

export class CreateGroupChatDto implements ICreateGroupChatRequest {
  @ApiProperty({ description: 'Group title (1-100 chars)', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  title!: string;

  @ApiProperty({
    description: 'Auth user ids of the other members (2-99, unique)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(99)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIds!: string[];
}
