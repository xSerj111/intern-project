import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import type { Chat } from './chat.entity';
// Type-only import: relation target resolved by entity name (string) to avoid a
// runtime dependency on the profiles module.
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';
import {
  EmptyMessageError,
  InvalidAttachmentError,
  MessageAlreadyDeletedError,
  MessageTooLongError,
  NotMessageAuthorError,
  SystemMessageImmutableError,
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

/**
 * An asset the sender wants to attach, as loaded by the service. `found` is
 * false (and the rest null) when no live asset has that id.
 */
export interface AttachmentCandidate {
  assetId: string;
  found: boolean;
  uploaderId: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | null;
  alreadyAttached: boolean;
}

/** Stored-file metadata of an attachment, loaded for responses (not a column). */
export interface MessageAttachmentFile {
  assetId: string;
  displayOrder: number;
  storageKey: string;
  mimeType: string;
  size: number;
  originalName: string | null;
}

export interface CreateMessageProps {
  chatId: string;
  authorId: string;
  content?: string | null;
  /** In request (display) order. */
  attachments?: AttachmentCandidate[];
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

  // Not a column: attachment asset ids in display order, filled by the
  // service from `message_assets` so edit/delete rules can see them.
  attachmentIds: string[] = [];

  // Not a column: file metadata of the attachments in display order, filled
  // by the repository/service for responses.
  attachments: MessageAttachmentFile[] = [];

  /**
   * Factory for a user message. Content is trimmed; it is either absent or
   * 1-2,000 chars; attachments are 0-10; at least one of the two is present.
   * Each attachment must be a live PRIVATE asset uploaded by the author and not
   * attached to any message yet.
   */
  static create(props: CreateMessageProps): Message {
    const content = props.content?.trim() || null;
    const candidates = props.attachments ?? [];
    const attachmentIds = candidates.map((c) => c.assetId);

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
    Message.assertAttachable(props.authorId, candidates);

    const message = new Message();
    message.chatId = props.chatId;
    message.authorId = props.authorId;
    message.kind = 'USER';
    message.content = content;
    message.seq = props.seq;
    message.changeSeq = props.seq;
    message.clientMessageId = props.clientMessageId;
    message.attachmentIds = attachmentIds;
    message.editedAt = null;
    message.systemEvent = null;
    return message;
  }

  private static assertAttachable(
    authorId: string,
    candidates: AttachmentCandidate[],
  ): void {
    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c.assetId)) {
        throw new InvalidAttachmentError(c.assetId, 'listed more than once');
      }
      seen.add(c.assetId);
      // One reason for missing/foreign assets so other users' ids aren't probed.
      if (!c.found || c.uploaderId !== authorId) {
        throw new InvalidAttachmentError(c.assetId, 'not found');
      }
      if (c.visibility !== 'PRIVATE') {
        throw new InvalidAttachmentError(c.assetId, 'not a chat upload');
      }
      if (c.alreadyAttached) {
        throw new InvalidAttachmentError(c.assetId, 'already attached');
      }
    }
  }

  /**
   * Factory for a membership/system message. The actor is stored as the
   * author and in the event payload.
   */
  static system(
    chatId: string,
    actorId: string,
    event: Omit<SystemEvent, 'actorId'> & { actorId?: string },
    seq: number,
  ): Message {
    const message = new Message();
    message.chatId = chatId;
    message.authorId = actorId;
    message.kind = 'SYSTEM';
    message.content = null;
    message.seq = seq;
    message.changeSeq = seq;
    message.clientMessageId = null;
    message.editedAt = null;
    message.systemEvent = { ...event, actorId };
    return message;
  }

  /**
   * Edits the text of a user message. Blank text is allowed only when the
   * message has attachments, in which case content becomes null.
   */
  edit(actorId: string, content: string, changeSeq: number): void {
    this.assertMutableBy(actorId);

    const next = content.trim() || null;
    if (next !== null && next.length > MESSAGE_CONTENT_MAX_LENGTH) {
      throw new MessageTooLongError(next.length, MESSAGE_CONTENT_MAX_LENGTH);
    }
    if (next === null && this.attachmentIds.length === 0) {
      throw new EmptyMessageError();
    }

    this.content = next;
    this.editedAt = new Date();
    this.changeSeq = changeSeq;
  }

  /** Turns the message into a tombstone: no text, no attachments. */
  delete(actorId: string, changeSeq: number): void {
    this.assertMutableBy(actorId);

    this.content = null;
    this.attachmentIds = [];
    this.attachments = [];
    this.deletedAt = new Date();
    this.changeSeq = changeSeq;
  }

  private assertMutableBy(actorId: string): void {
    if (this.kind === 'SYSTEM') throw new SystemMessageImmutableError();
    if (this.authorId !== actorId) throw new NotMessageAuthorError();
    if (this.deletedAt != null) throw new MessageAlreadyDeletedError();
  }

  /** A message is visible while the viewer is a member and it postdates their join. */
  isVisibleTo(participant: MessageViewer): boolean {
    return participant.leftAt == null && this.seq > participant.joinedSeq;
  }

  /**
   * The attachment a viewer may download: the message is visible to them, not
   * deleted, and `assetId` is one of its attachments. Null otherwise.
   */
  attachmentFor(
    viewer: MessageViewer,
    assetId: string,
  ): MessageAttachmentFile | null {
    if (this.deletedAt != null || !this.isVisibleTo(viewer)) return null;
    return this.attachments.find((a) => a.assetId === assetId) ?? null;
  }
}
