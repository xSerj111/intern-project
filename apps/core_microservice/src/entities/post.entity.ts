import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  DeleteDateColumn, 
  OneToMany, 
  Index 
} from 'typeorm';
import { Comment } from './comment.entity';
import { Like } from './like.entity';

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Logical reference to AuthUser. Indexed for feeds/queries.
  @Index()
  @Column({ type: 'uuid' })
  authorId: string;

  @Column({ type: 'text' })
  content: string;

  // Leveraging PostgreSQL native arrays for media URLs
  @Column({ type: 'text', array: true, default: [] })
  mediaUrls: string[];

  @OneToMany(() => Comment, (comment) => comment.post)
  comments: Comment[];

  @OneToMany(() => Like, (like) => like.post)
  likes: Like[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}