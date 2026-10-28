import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { ChatMembershipService } from './chat-membership.service';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { AttachmentsController } from './attachments.controller';
import { Chat } from './domain/entities/chat.entity';
import { ChatParticipant } from './domain/entities/chat-participant.entity';
import { Message } from './domain/entities/message.entity';
import { MessageAttachment } from './domain/entities/message-attachment.entity';
import { LoggerModule } from '@repo/shared';
import { CommonAuthModule } from '../../common/auth/common-auth.module';
import { SessionRevocationListener } from '../../common/redis/session-revocation.listener';
import { CHAT_REALTIME_PORT } from './domain/interfaces/chat-realtime.port';
import { ChatsGateway } from './infrastructure/realtime/chats.gateway';
import { CHAT_REPOSITORY } from './domain/interfaces/chat-repository.port';
import { MESSAGE_REPOSITORY } from './domain/interfaces/message-repository.port';
import { ChatRepository } from './infrastructure/repository/chat.repository';
import { MessageRepository } from './infrastructure/repository/message.repository';
import { ProfilesModule } from '../profiles/profiles.module';
import { AssetsModule } from '../assets/assets.module';
import { ATTACHMENT_STORAGE_PORT } from './domain/interfaces/attachment-storage.port';
import { AttachmentStorageAdapter } from './infrastructure/storage/attachment-storage.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Chat,
      ChatParticipant,
      Message,
      MessageAttachment,
    ]),
    LoggerModule.forFeature('ChatsService'),
    CommonAuthModule,
    ProfilesModule,
    AssetsModule,
  ],
  controllers: [ChatsController, MessagesController, AttachmentsController],
  providers: [
    ChatsService,
    MessagesService,
    ChatMembershipService,
    { provide: CHAT_REPOSITORY, useClass: ChatRepository },
    { provide: MESSAGE_REPOSITORY, useClass: MessageRepository },
    { provide: ATTACHMENT_STORAGE_PORT, useClass: AttachmentStorageAdapter },
    ChatsGateway,
    { provide: CHAT_REALTIME_PORT, useExisting: ChatsGateway },
    SessionRevocationListener,
  ],
  exports: [CHAT_REALTIME_PORT],
})
export class ChatsModule {}
