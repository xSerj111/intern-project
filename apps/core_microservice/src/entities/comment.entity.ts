import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  DeleteDateColumn, 
  ManyToOne, 
  JoinColumn, 
  Index
} from 'typeorm';
import { Post } from './post.entity';
import { UserProfile } from './user-profile.entity';

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  postId!: string;

  @ManyToOne(() => Post, (post) => post.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post!: Post;

  //ID for the parent comment (nullable because top-level comments have no parents)
  @Column({ type: 'uuid', nullable: true })
  parentId?: string;

  // if the parent comment deleted, nested also deleted
  @ManyToOne(() => Comment, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent?: Comment;

  // Logical reference to AuthUser
  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => UserProfile)
  @JoinColumn({ name: 'authorId'})
  author!: UserProfile;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date;
}