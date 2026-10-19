import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { ICreateDirectChatRequest } from '@repo/contracts';

export class CreateDirectChatDto implements ICreateDirectChatRequest {
  @ApiProperty({ description: 'Auth user id of the other participant' })
  @IsUUID()
  userId!: string;
}
