import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ChatsService } from './chats.service';


@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  
}
