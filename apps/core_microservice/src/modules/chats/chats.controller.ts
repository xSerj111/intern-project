import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('messages')
  async sendMessage(@Body() createMessageDto: CreateMessageDto): Promise<MessageResponseDto> {
    //TODO: change temp userid for real from jwt
    const TEMP_USER_ID = 'test-user-123';

    const message = await this.chatsService.sendMessage(
      TEMP_USER_ID,
      createMessageDto.chatId,
      createMessageDto.content
      );

    return new MessageResponseDto(message);
  }
    
}
