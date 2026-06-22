import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn, 
  Index,
  DeleteDateColumn
} from 'typeorm';
import { Comment } from './comment.entity';

@Entity('comment_likes')
@Index(['commentId', 'userId'], { unique: true }) // Prevent duplicate likes on a comment
export class CommentLike {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  commentId!: string;

  @ManyToOne(() => Comment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commentId' })
  comment!: Comment;

  // Logical reference to AuthUser
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date; 
}