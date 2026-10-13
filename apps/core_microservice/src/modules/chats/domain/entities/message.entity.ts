import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import type { Chat } from './chat.entity';
// Type-only import: relation target resolved by entity name (string) to avoid a
// runtime dependency on the profiles module.
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';
import {
  EmptyMessageError,
  MessageTooLongError,
  TooManyAttachmentsError,
} from '../errors/chat.errors';

export const MESSAGE_CONTENT_MAX_LENGTH = 2000;
export const MESSAGE_MAX_ATTACHMENTS = 10;

export type MessageKind = 'USER' | 'SYSTEM';

export type SystemEventType =
  | 'group_created'
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  | 'admin_promoted'
  | 'group_renamed';

export interface SystemEvent {
  type: SystemEventType;
  actorId: string;
  targetUserIds?: string[];
  title?: string;
}

export interface CreateMessageProps {
  chatId: string;
  authorId: string;
  content?: string | null;
  attachmentIds?: string[];
  clientMessageId: string;
  seq: number;
}

/** The slice of a participant needed to decide message visibility. */
export interface MessageViewer {
  leftAt: Date | null;
  joinedSeq: number;
}

// Postgres returns bigint as string; sequences stay far below 2^53.
const bigintTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

@Entity('messages')
@Index('IDX_messages_chatId_seq', ['chatId', 'seq'], { unique: true })
@Index('IDX_messages_chatId_changeSeq', ['chatId', 'changeSeq'])
@Index(
  'IDX_messages_chatId_authorId_clientMessageId',
  ['chatId', 'authorId', 'clientMessageId'],
  { unique: true },
)
export class Message extends TypeormEntityBase {
  @Index()
  @Column({ type: 'uuid' })
  chatId!: string;

  @ManyToOne('Chat', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat!: Chat;

  // For SYSTEM messages this is the actor.
  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne('UserProfile', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId', referencedColumnName: 'authUserId' })
  author!: UserProfile;

  @Column({ type: 'varchar', length: 10, default: 'USER' })
  kind!: MessageKind;

  // Null for attachment-only messages and after deletion.
  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  seq!: number;

  // Equals seq at creation; bumped on edit/delete. Catch-up cursor.
  @Column({ type: 'bigint', transformer: bigintTransformer })
  changeSeq!: number;

  @Column({ type: 'uuid', nullable: true })
  clientMessageId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  systemEvent!: SystemEvent | null;

  /**
   * Factory for a user message. Content is trimmed; it is either absent or
   * 1-2,000 chars; attachments are 0-10; at least one of the two is present.
   */
  static create(props: CreateMessageProps): Message {
    const content = props.content?.trim() || null;
    const attachmentIds = props.attachmentIds ?? [];

    if (content !== null && content.length > MESSAGE_CONTENT_MAX_LENGTH) {
      throw new MessageTooLongError(content.length, MESSAGE_CONTENT_MAX_LENGTH);
    }
    if (attachmentIds.length > MESSAGE_MAX_ATTACHMENTS) {
      throw new TooManyAttachmentsError(
        attachmentIds.length,
        MESSAGE_MAX_ATTACHMENTS,
      );
    }
    if (content === null && attachmentIds.length === 0) {
      throw new EmptyMessageError();
    }

    const message = new Message();
    message.chatId = props.chatId;
    message.authorId = props.authorId;
    message.kind = 'USER';
    message.content = content;
    message.seq = props.seq;
    message.changeSeq = props.seq;
    message.clientMessageId = props.clientMessageId;
    message.editedAt = null;
    message.systemEvent = null;
    return message;
  }

  /** A message is visible while the viewer is a member and it postdates their join. */
  isVisibleTo(participant: MessageViewer): boolean {
    return participant.leftAt == null && this.seq > participant.joinedSeq;
  }
}
