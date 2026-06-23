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
import { Post } from './post.entity';

@Entity('likes')
@Index(['postId', 'userId'], { unique: true }) // Prevent duplicate likes
export class Like {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  postId: string;

  @ManyToOne(() => Post, (post) => post.likes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  // Logical reference to AuthUser
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date; // For soft-undistributing metrics if needed
}