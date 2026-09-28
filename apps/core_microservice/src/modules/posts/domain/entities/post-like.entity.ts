import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  DeleteDateColumn,
} from 'typeorm';
import type { Post } from './post.entity';

@Entity('post_likes')
@Index(['postId', 'userId'], { unique: true }) // Prevent duplicate likes on a post
export class PostLike {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  postId!: string;

  @ManyToOne('Post', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post!: Post;

  // Logical reference to AuthUser
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date;

  /** Factory: build a like of a post by a user. */
  static create(postId: string, userId: string): PostLike {
    const like = new PostLike();
    like.postId = postId;
    like.userId = userId;
    return like;
  }
}
