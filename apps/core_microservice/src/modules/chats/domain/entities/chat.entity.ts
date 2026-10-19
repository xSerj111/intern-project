import { Column, Entity, Index, OneToMany, Unique } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import { bigintNumberTransformer } from '../../../../common/typeorm/bigint-number.transformer';
import { ChatParticipant, ParticipantRole } from './chat-participant.entity';
import type { SystemEvent } from './message.entity';
import {
  CannotChatWithSelfError,
  ChatNotFoundError,
  InvalidGroupSizeError,
  InvalidGroupTitleError,
  NotAGroupChatError,
  NotAParticipantError,
  NotChatAdminError,
} from '../errors/chat.errors';

export enum ChatType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
}

export const GROUP_TITLE_MAX_LENGTH = 100;
// Others invited at creation (the creator comes on top).
export const GROUP_MIN_INVITEES = 2;
export const GROUP_MAX_INVITEES = 99;
export const GROUP_MAX_MEMBERS = 100;

@Entity('chats')
@Index('IDX_chats_lastActivityAt', ['lastActivityAt'])
@Unique('UQ_chats_directKey', ['directKey'])
export class Chat extends TypeormEntityBase {
  @Column({ type: 'varchar', length: 20, default: ChatType.DIRECT })
  type!: ChatType;

  // Group name. Always null for DIRECT chats.
  @Column({ type: 'varchar', length: 100, nullable: true })
  title!: string | null;

  // "{minUserId}:{maxUserId}" for DIRECT, null for GROUP: one private chat per pair.
  @Column({ type: 'varchar', length: 73, nullable: true })
  directKey!: string | null;

  // Nullable only for legacy rows the migration could not backfill.
  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  // Per-chat counter used for every seq/changeSeq.
  @Column({
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  lastSeq!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastActivityAt!: Date;

  @OneToMany(() => ChatParticipant, (participant) => participant.chat, {
    cascade: true,
  })
  participants!: ChatParticipant[];

  /**
   * Builds a private chat between two distinct users. The direct key orders
   * the ids so (a, b) and (b, a) resolve to the same chat.
   */
  static createDirect(a: string, b: string): Chat {
    if (a === b) throw new CannotChatWithSelfError();

    const now = new Date();
    const chat = new Chat();
    chat.type = ChatType.DIRECT;
    chat.title = null;
    chat.directKey = a < b ? `${a}:${b}` : `${b}:${a}`;
    chat.createdById = a;
    chat.lastSeq = 0;
    chat.lastActivityAt = now;
    chat.participants = [a, b].map((userId) =>
      newParticipant(userId, ParticipantRole.MEMBER, now, 0),
    );
    return chat;
  }

  /**
   * Builds a group with the creator as ADMIN and 2-99 distinct other members.
   * Returns the chat (unsaved) and the group_created event to write.
   */
  static createGroup(
    creatorId: string,
    title: string,
    memberIds: string[],
  ): { chat: Chat; events: SystemEvent[] } {
    const name = validTitle(title);
    const distinct = new Set(memberIds);
    if (
      distinct.size !== memberIds.length ||
      distinct.has(creatorId) ||
      memberIds.length < GROUP_MIN_INVITEES ||
      memberIds.length > GROUP_MAX_INVITEES
    ) {
      throw new InvalidGroupSizeError(
        memberIds.length,
        GROUP_MIN_INVITEES,
        GROUP_MAX_INVITEES,
      );
    }

    const now = new Date();
    const chat = new Chat();
    chat.type = ChatType.GROUP;
    chat.title = name;
    chat.directKey = null;
    chat.createdById = creatorId;
    chat.lastSeq = 0;
    chat.lastActivityAt = now;
    chat.participants = [
      newParticipant(creatorId, ParticipantRole.ADMIN, now, 0),
      ...memberIds.map((userId) =>
        newParticipant(userId, ParticipantRole.MEMBER, now, 0),
      ),
    ];
    const event: SystemEvent = {
      type: 'group_created',
      actorId: creatorId,
      targetUserIds: [...memberIds],
      title: name,
    };
    return { chat, events: [event] };
  }

  /**
   * Adds users, inserting new rows or reactivating a departed user's row with
   * joinedSeq = lastSeq so earlier history stays hidden. Already-active users
   * are skipped; returns [] when nobody was added.
   */
  addMembers(actorId: string, userIds: string[]): SystemEvent[] {
    this.assertAdmin(actorId);
    const toAdd = [...new Set(userIds)].filter((id) => !this.participantOf(id));
    if (toAdd.length === 0) return [];

    const size = this.activeParticipants().length + toAdd.length;
    if (size > GROUP_MAX_MEMBERS) {
      throw new InvalidGroupSizeError(
        size,
        GROUP_MIN_INVITEES + 1,
        GROUP_MAX_MEMBERS,
      );
    }

    const now = new Date();
    for (const userId of toAdd) {
      const existing = this.rowOf(userId);
      if (existing) {
        existing.role = ParticipantRole.MEMBER;
        existing.joinedAt = now;
        existing.joinedSeq = this.lastSeq;
        existing.lastReadSeq = Math.max(existing.lastReadSeq, this.lastSeq);
        existing.leftAt = null;
      } else {
        const participant = newParticipant(
          userId,
          ParticipantRole.MEMBER,
          now,
          this.lastSeq,
        );
        participant.chatId = this.id;
        this.participants.push(participant);
      }
    }
    return [{ type: 'member_added', actorId, targetUserIds: toAdd }];
  }

  removeMember(actorId: string, userId: string): SystemEvent[] {
    this.assertAdmin(actorId);
    const target = this.participantOf(userId);
    if (!target || userId === actorId) throw new NotAParticipantError(userId);

    target.leftAt = new Date();
    return [{ type: 'member_removed', actorId, targetUserIds: [userId] }];
  }

  /** Makes an active MEMBER an ADMIN; promoting an existing admin is a no-op. */
  promote(actorId: string, userId: string): SystemEvent[] {
    this.assertAdmin(actorId);
    const target = this.participantOf(userId);
    if (!target) throw new NotAParticipantError(userId);
    if (target.role === ParticipantRole.ADMIN) return [];

    target.role = ParticipantRole.ADMIN;
    return [{ type: 'admin_promoted', actorId, targetUserIds: [userId] }];
  }

  rename(actorId: string, title: string): SystemEvent[] {
    this.assertAdmin(actorId);
    this.title = validTitle(title);
    return [{ type: 'group_renamed', actorId, title: this.title }];
  }

  /**
   * Marks the user as left. If that leaves no active admin while members
   * remain, the member with the earliest joinedAt (then joinedSeq, then
   * userId) becomes ADMIN and an admin_promoted event follows member_left.
   */
  leave(userId: string): SystemEvent[] {
    this.assertGroup();
    const me = this.participantOf(userId);
    if (!me) throw new NotAParticipantError(userId);

    me.leftAt = new Date();
    const events: SystemEvent[] = [{ type: 'member_left', actorId: userId }];

    const remaining = this.activeParticipants();
    const hasAdmin = remaining.some((p) => p.role === ParticipantRole.ADMIN);
    if (!hasAdmin && remaining.length > 0) {
      const [successor] = [...remaining].sort(bySeniority);
      successor.role = ParticipantRole.ADMIN;
      events.push({
        type: 'admin_promoted',
        actorId: userId,
        targetUserIds: [successor.userId],
      });
    }
    return events;
  }

  activeParticipants(): ChatParticipant[] {
    return (this.participants ?? []).filter((p) => p.leftAt == null);
  }

  participantOf(userId: string): ChatParticipant | undefined {
    return this.activeParticipants().find((p) => p.userId === userId);
  }

  private rowOf(userId: string): ChatParticipant | undefined {
    return (this.participants ?? []).find((p) => p.userId === userId);
  }

  private assertGroup(): void {
    if (this.type !== ChatType.GROUP) throw new NotAGroupChatError(this.id);
  }

  private assertAdmin(actorId: string): void {
    this.assertGroup();
    if (this.participantOf(actorId)?.role !== ParticipantRole.ADMIN) {
      throw new NotChatAdminError();
    }
  }

  // 404 rather than 403 so a chat's existence is not revealed.
  assertCanRead(userId: string): void {
    if (!this.participantOf(userId)) throw new ChatNotFoundError(this.id);
  }

  assertCanPost(userId: string): void {
    if (!this.participantOf(userId)) throw new ChatNotFoundError(this.id);
  }
}

function newParticipant(
  userId: string,
  role: ParticipantRole,
  joinedAt: Date,
  joinedSeq: number,
): ChatParticipant {
  const participant = new ChatParticipant();
  participant.userId = userId;
  participant.role = role;
  participant.joinedAt = joinedAt;
  participant.joinedSeq = joinedSeq;
  participant.lastReadSeq = joinedSeq;
  participant.leftAt = null;
  return participant;
}

function validTitle(title: string): string {
  const name = title.trim();
  if (name.length < 1 || name.length > GROUP_TITLE_MAX_LENGTH) {
    throw new InvalidGroupTitleError(name.length, 1, GROUP_TITLE_MAX_LENGTH);
  }
  return name;
}

// Admin succession order: earliest joinedAt, then joinedSeq, then userId.
function bySeniority(a: ChatParticipant, b: ChatParticipant): number {
  return (
    a.joinedAt.getTime() - b.joinedAt.getTime() ||
    a.joinedSeq - b.joinedSeq ||
    (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  );
}
