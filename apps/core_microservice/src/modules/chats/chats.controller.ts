import {
  Controller,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { toMessageResponse } from './dto/chat-response.mapper';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Interim bridge onto the B04 DTOs; the full controller is rebuilt in B05.
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post(':chatId/messages')
  @UseGuards(JwtAuthGuard)
  async sendMessage(
    @CurrentUser('sub') authorId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    const message = await this.chatsService.sendMessage(
      authorId,
      chatId,
      dto.content ?? '',
    );

    return toMessageResponse(message);
  }
}
