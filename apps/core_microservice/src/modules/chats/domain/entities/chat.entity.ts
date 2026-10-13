import {
  Column,
  Entity,
  Index,
  OneToMany,
  Unique,
  ValueTransformer,
} from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import { ChatParticipant, ParticipantRole } from './chat-participant.entity';
import {
  CannotChatWithSelfError,
  ChatNotFoundError,
} from '../errors/chat.errors';

export enum ChatType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
}

// Postgres returns bigint as string; counters stay well below 2^53.
const bigintTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) =>
    value === null || value === undefined ? value : Number(value),
};

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
    transformer: bigintTransformer,
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
    chat.participants = [a, b].map((userId) => {
      const participant = new ChatParticipant();
      participant.userId = userId;
      participant.role = ParticipantRole.MEMBER;
      participant.joinedAt = now;
      participant.joinedSeq = 0;
      participant.lastReadSeq = 0;
      participant.leftAt = null;
      return participant;
    });
    return chat;
  }

  activeParticipants(): ChatParticipant[] {
    return (this.participants ?? []).filter((p) => p.leftAt == null);
  }

  participantOf(userId: string): ChatParticipant | undefined {
    return this.activeParticipants().find((p) => p.userId === userId);
  }

  // 404 rather than 403 so a chat's existence is not revealed.
  assertCanRead(userId: string): void {
    if (!this.participantOf(userId)) throw new ChatNotFoundError(this.id);
  }

  assertCanPost(userId: string): void {
    if (!this.participantOf(userId)) throw new ChatNotFoundError(this.id);
  }
}
