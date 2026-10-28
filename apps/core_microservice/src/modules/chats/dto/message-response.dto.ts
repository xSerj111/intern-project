import { ApiProperty } from '@nestjs/swagger';
import type {
  ChatType,
  IAttachment,
  IAttachmentUrl,
  ICursorPage,
  IChatParticipant,
  IChatUser,
  IConversationDetail,
  IConversationSummary,
  IMessage,
  IReadState,
  IUploadedAttachment,
  ParticipantRole,
  SystemEventType,
} from '@repo/contracts';

export class ChatUserDto implements IChatUser {
  @ApiProperty() userId!: string;
  @ApiProperty() username!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}

export class ChatParticipantDto
  extends ChatUserDto
  implements IChatParticipant
{
  @ApiProperty({ enum: ['ADMIN', 'MEMBER'] }) role!: ParticipantRole;
  @ApiProperty() joinedAt!: string;
}

export class AttachmentDto implements IAttachment {
  @ApiProperty() id!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() size!: number;
  @ApiProperty() originalName!: string;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() url!: string;
  @ApiProperty() urlExpiresAt!: string;
  @ApiProperty({ enum: ['image', 'video', 'file'] })
  kind!: 'image' | 'video' | 'file';
}

export class UploadedAttachmentDto implements IUploadedAttachment {
  @ApiProperty() id!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() size!: number;
  @ApiProperty() originalName!: string;
}

export class AttachmentUrlDto implements IAttachmentUrl {
  @ApiProperty() url!: string;
  @ApiProperty() expiresAt!: string;
}

export class SystemEventDto {
  @ApiProperty({
    enum: [
      'group_created',
      'member_added',
      'member_removed',
      'member_left',
      'admin_promoted',
      'group_renamed',
    ],
  })
  type!: SystemEventType;
  @ApiProperty() actorId!: string;
  @ApiProperty({ type: [String], required: false }) targetUserIds?: string[];
  @ApiProperty({ type: String, required: false }) title?: string;
}

export class MessageResponseDto implements IMessage {
  @ApiProperty() id!: string;
  @ApiProperty() chatId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ enum: ['USER', 'SYSTEM'] }) kind!: 'USER' | 'SYSTEM';
  @ApiProperty() seq!: number;
  @ApiProperty() changeSeq!: number;
  @ApiProperty({ type: String, nullable: true })
  clientMessageId!: string | null;
  @ApiProperty({ type: String, nullable: true }) content!: string | null;
  @ApiProperty({ type: [AttachmentDto] }) attachments!: AttachmentDto[];
  @ApiProperty({ type: SystemEventDto, nullable: true })
  systemEvent!: SystemEventDto | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) editedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) deletedAt!: string | null;
}

export class ConversationSummaryDto implements IConversationSummary {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['DIRECT', 'GROUP'] }) type!: ChatType;
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty({ type: ChatUserDto, nullable: true })
  counterpart!: ChatUserDto | null;
  @ApiProperty() memberCount!: number;
  @ApiProperty({ type: MessageResponseDto, nullable: true })
  lastMessage!: MessageResponseDto | null;
  @ApiProperty() lastActivityAt!: string;
  @ApiProperty() lastChangeSeq!: number;
  @ApiProperty() unreadCount!: number;
  @ApiProperty({ enum: ['ADMIN', 'MEMBER'] }) myRole!: ParticipantRole;
}

export class ConversationDetailDto
  extends ConversationSummaryDto
  implements IConversationDetail
{
  @ApiProperty({ type: [ChatParticipantDto] })
  participants!: ChatParticipantDto[];
}

export class ReadStateDto implements IReadState {
  @ApiProperty() chatId!: string;
  @ApiProperty() lastReadSeq!: number;
  @ApiProperty() unreadCount!: number;
}

/** Documentation shape of `ICursorPage<MessageResponseDto>`. */
export class MessagePageDto implements ICursorPage<MessageResponseDto> {
  @ApiProperty({ type: [MessageResponseDto] }) items!: MessageResponseDto[];
  @ApiProperty() hasMore!: boolean;
}

/** Documentation shape of `ICursorPage<IConversationSummary>`. */
export class ConversationSummaryPageDto implements ICursorPage<ConversationSummaryDto> {
  @ApiProperty({ type: [ConversationSummaryDto] })
  items!: ConversationSummaryDto[];
  @ApiProperty() hasMore!: boolean;
}
