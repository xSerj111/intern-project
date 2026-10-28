import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { IEditMessageRequest } from '@repo/contracts';

export class EditMessageDto implements IEditMessageRequest {
  @ApiProperty({
    description: 'New message text (0-2000 chars); blank only if attachments',
  })
  @IsString({ message: 'Content must be a text' })
  @MaxLength(2000, { message: 'Message is too long (max 2000 chars)' })
  content!: string;
}
