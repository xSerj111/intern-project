import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Chat } from './chat.entity';
import { bigintNumberTransformer } from '../../../../common/typeorm/bigint-number.transformer';
// Type-only import: relation target resolved by entity name (string) to avoid a
// runtime dependency on the profiles module.
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';

export enum ParticipantRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

@Entity('chat_participants')
@Index(['chatId', 'userId'], { unique: true }) // A user can only be in a specific chat once
@Index('IDX_chat_participants_userId_active', ['userId'], {
  where: '"leftAt" IS NULL',
})
export class ChatParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  chatId!: string;

  @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat!: Chat;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne('UserProfile', { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    referencedColumnName: 'authUserId',
    foreignKeyConstraintName: 'FK_chat_participants_userId_authUserId',
  })
  user!: UserProfile;

  @Column({
    type: 'varchar',
    length: 20,
    default: ParticipantRole.MEMBER,
  })
  role!: ParticipantRole;

  // Most recent join time; set again on re-join
  @Column({ type: 'timestamptz', default: () => 'now()' })
  joinedAt!: Date;

  // Chat lastSeq at the most recent join; messages with seq > joinedSeq are visible
  @Column({ type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  joinedSeq!: number;

  // Null means active
  @Column({ type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  // Never moves backwards, never below joinedSeq
  @Column({ type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  lastReadSeq!: number;

  @UpdateDateColumn()
  updatedAt!: Date;

  isActive(): boolean {
    return this.leftAt === null || this.leftAt === undefined;
  }

  markRead(seq: number, chatLastSeq: number): void {
    const target = Math.min(seq, chatLastSeq);
    this.lastReadSeq = Math.max(this.lastReadSeq, this.joinedSeq, target);
  }
}
