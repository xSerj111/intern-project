import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { ISendMessageRequest } from '@repo/contracts';

export class SendMessageDto implements ISendMessageRequest {
  @ApiProperty({ description: 'Client-generated id, makes sends idempotent' })
  @IsUUID()
  clientMessageId!: string;

  @ApiPropertyOptional({ description: 'Message text (max 2000 chars)' })
  @IsOptional()
  @IsString({ message: 'Content must be a text' })
  @MaxLength(2000, { message: 'Message is too long (max 2000 chars)' })
  content?: string;

  @ApiPropertyOptional({
    description: 'Uploaded asset ids, in display order',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}
