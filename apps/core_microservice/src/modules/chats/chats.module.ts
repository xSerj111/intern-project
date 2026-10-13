import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { Chat } from './domain/entities/chat.entity';
import { ChatParticipant } from './domain/entities/chat-participant.entity';
import { Message } from './domain/entities/message.entity';
import { MessageAsset } from './domain/entities/message-asset.entity';
import { LoggerModule } from '@repo/shared';
import { CommonAuthModule } from '../../common/auth/common-auth.module';
import { SessionRevocationListener } from '../../common/redis/session-revocation.listener';
import { CHAT_REALTIME_PORT } from './domain/interfaces/chat-realtime.port';
import { ChatsGateway } from './infrastructure/realtime/chats.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, ChatParticipant, Message, MessageAsset]),
    LoggerModule.forFeature('ChatsService'),
    CommonAuthModule,
  ],
  controllers: [ChatsController],
  providers: [
    ChatsService,
    ChatsGateway,
    { provide: CHAT_REALTIME_PORT, useExisting: ChatsGateway },
    SessionRevocationListener,
  ],
  exports: [CHAT_REALTIME_PORT],
})
export class ChatsModule {}
