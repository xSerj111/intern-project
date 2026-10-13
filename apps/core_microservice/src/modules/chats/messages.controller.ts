import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ICursorPage } from '@repo/contracts';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MessageChangesQueryDto } from './dto/message-changes-query.dto';
import type { MessageResponseDto } from './dto/message-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats/:chatId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  history(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<ICursorPage<MessageResponseDto>> {
    return this.messagesService.history(userId, chatId, query);
  }

  // Declared before any `:messageId` route so `changes` is never captured as an id.
  @Get('changes')
  changes(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query() query: MessageChangesQueryDto,
  ): Promise<ICursorPage<MessageResponseDto>> {
    return this.messagesService.changes(userId, chatId, query);
  }

  /** 201 for a new message, 200 for an idempotent replay of `clientMessageId`. */
  @Post()
  async send(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: SendMessageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const { message, created } = await this.messagesService.send(
      userId,
      chatId,
      dto,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return message;
  }
}
