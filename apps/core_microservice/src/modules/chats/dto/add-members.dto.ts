import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import type { IAddMembersRequest } from '@repo/contracts';

export class AddMembersDto implements IAddMembersRequest {
  @ApiProperty({
    description: 'Auth user ids to add (1-98, unique)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(98)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds!: string[];
}
