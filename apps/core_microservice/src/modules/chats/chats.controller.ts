import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ChatMembershipService } from './chat-membership.service';
import { AddMembersDto } from './dto/add-members.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { RenameGroupDto } from './dto/rename-group.dto';
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
  constructor(
    private readonly chatsService: ChatsService,
    private readonly membership: ChatMembershipService,
  ) {}

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

  @Post('groups')
  createGroup(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateGroupChatDto,
  ): Promise<ConversationDetailDto> {
    return this.membership.createGroup(userId, dto);
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

  @Patch(':chatId')
  rename(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: RenameGroupDto,
  ): Promise<ConversationDetailDto> {
    return this.membership.rename(userId, chatId, dto);
  }

  @Post(':chatId/members')
  @HttpCode(HttpStatus.OK)
  addMembers(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: AddMembersDto,
  ): Promise<ConversationDetailDto> {
    return this.membership.addMembers(userId, chatId, dto);
  }

  @Delete(':chatId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('userId', ParseUUIDPipe) targetId: string,
  ): Promise<void> {
    return this.membership.removeMember(userId, chatId, targetId);
  }

  @Post(':chatId/members/:userId/promote')
  @HttpCode(HttpStatus.OK)
  promote(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('userId', ParseUUIDPipe) targetId: string,
  ): Promise<ConversationDetailDto> {
    return this.membership.promote(userId, chatId, targetId);
  }

  @Post(':chatId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
  ): Promise<void> {
    return this.membership.leave(userId, chatId);
  }
}
