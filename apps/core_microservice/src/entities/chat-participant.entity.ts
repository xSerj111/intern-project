import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn, 
  Index 
} from 'typeorm';
import { Chat } from './chat.entity';
import { UserProfile } from './user-profile.entity';

@Entity('chat_participants')
@Index(['chatId', 'userId'], { unique: true }) // A user can only be in a specific chat once
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

  @ManyToOne(() => UserProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserProfile;

  // e.g., 'ADMIN' or 'MEMBER'
  @Column({ type: 'varchar', length: 20, default: 'MEMBER' })
  role!: string;

  @CreateDateColumn()
  joinedAt!: Date;
}