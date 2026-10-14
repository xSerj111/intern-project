import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { ICursorPage } from '@repo/contracts';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MessageChangesQueryDto } from './dto/message-changes-query.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats/:chatId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @ApiOperation({ summary: "List a conversation's messages (cursor page)" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cursor page of messages, newest first',
  })
  history(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<ICursorPage<MessageResponseDto>> {
    return this.messagesService.history(userId, chatId, query);
  }

  // Declared before any `:messageId` route so `changes` is never captured as an id.
  @Get('changes')
  @ApiOperation({ summary: 'Messages changed since a sequence number' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cursor page of created or edited messages',
  })
  changes(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query() query: MessageChangesQueryDto,
  ): Promise<ICursorPage<MessageResponseDto>> {
    return this.messagesService.changes(userId, chatId, query);
  }

  /** 201 for a new message, 200 for an idempotent replay of `clientMessageId`. */
  @Post()
  @ApiOperation({ summary: 'Send a message (idempotent via clientMessageId)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Message created',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Replay of an existing clientMessageId; original message',
    type: MessageResponseDto,
  })
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

  @Patch(':messageId')
  @ApiOperation({ summary: 'Edit your own message' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Message updated',
    type: MessageResponseDto,
  })
  edit(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messagesService.edit(userId, chatId, messageId, dto);
  }

  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete your own message' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Message deleted',
  })
  delete(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.messagesService.delete(userId, chatId, messageId);
  }
}
