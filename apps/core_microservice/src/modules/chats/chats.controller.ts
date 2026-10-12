import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('messages')
  @UseGuards(JwtAuthGuard)
  async sendMessage(
    @CurrentUser('sub') authorId: string,
    @Body() createMessageDto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    const message = await this.chatsService.sendMessage(
      authorId,
      createMessageDto.chatId,
      createMessageDto.content,
    );

    return new MessageResponseDto(message);
  }
}
