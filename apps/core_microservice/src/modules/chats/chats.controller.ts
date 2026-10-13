import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import type {
  ICursorPage,
  IConversationSummary,
  IReadState,
} from '@repo/contracts';
import { ChatsService } from './chats.service';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { ListChatsQueryDto } from './dto/list-chats-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import type { ConversationDetailDto } from './dto/message-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  /** 201 when the conversation was created, 200 when the pair already had one. */
  @Post('direct')
  async createDirect(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateDirectChatDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConversationDetailDto> {
    const { created, chat } = await this.chatsService.createDirect(
      userId,
      dto.userId,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return chat;
  }

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListChatsQueryDto,
  ): Promise<ICursorPage<IConversationSummary>> {
    return this.chatsService.list(userId, query);
  }

  @Get(':chatId')
  getDetail(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
  ): Promise<ConversationDetailDto> {
    return this.chatsService.getDetail(userId, chatId);
  }

  @Post(':chatId/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: MarkReadDto,
  ): Promise<IReadState> {
    return this.chatsService.markRead(userId, chatId, dto.seq);
  }
}
