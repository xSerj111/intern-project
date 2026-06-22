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

@Entity('post_likes')
@Index(['postId', 'userId'], { unique: true }) // Prevent duplicate likes on a post
export class PostLike {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  postId: string;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  // Logical reference to AuthUser
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date; 
}