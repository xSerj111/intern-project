import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { Chat } from './domain/entities/chat.entity';
import { ChatParticipant } from './domain/entities/chat-participant.entity';
import { Message } from './domain/entities/message.entity';
import { MessageAsset } from './domain/entities/message-asset.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, ChatParticipant, Message, MessageAsset]),
  ],
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}
