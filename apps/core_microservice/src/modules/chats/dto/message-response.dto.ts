import { ApiProperty } from '@nestjs/swagger';
import { IMessageResponse } from '@repo/contracts';
import { Message } from '../domain/entities/message.entity';

export class MessageResponseDto implements IMessageResponse {
  @ApiProperty() id: string;
  @ApiProperty() chatId: string;
  @ApiProperty() authorId: string;
  @ApiProperty() content: string;
  @ApiProperty() createdAt: string;

  constructor(message: Message) {
    this.id = message.id;
    this.chatId = message.chatId;
    this.authorId = message.authorId;
    this.content = message.content ?? '';
    this.createdAt = message.createdAt.toISOString();
  }
}
