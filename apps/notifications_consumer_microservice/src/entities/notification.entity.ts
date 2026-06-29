import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn()
  id!: string;

  // Logical reference to the AuthUser receiving the notification
  @Index()
  @Column({ type: 'uuid' })
  recipientId!: string;

  // e.g., 'NEW_FOLLOWER', 'POST_LIKED', 'NEW_COMMENT', 'SYSTEM_ALERT'
  @Index()
  @Column({ type: 'varchar', length: 50 })
  type!: string;

  // Flexible payload to store event-specific data (e.g., { actorId: '...', postId: '...' })
  // 'jsonb' is highly optimized in PostgreSQL
  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Supports eventual consistency and user data deletion
  @DeleteDateColumn()
  deletedAt!: Date;
}
