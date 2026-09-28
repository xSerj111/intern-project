import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Chat } from './chat.entity';
// Type-only import: relation target resolved by entity name (string) to avoid a
// runtime dependency on the profiles module.
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  chatId!: string;

  @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat!: Chat;

  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne('UserProfile', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId', referencedColumnName: 'authUserId' })
  author!: UserProfile;

  // Nullable because a message could just be an image/asset with no text!
  @Column({ type: 'text', nullable: true })
  content?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date; // Important: Soft-deleting messages is a standard social network feature
}
