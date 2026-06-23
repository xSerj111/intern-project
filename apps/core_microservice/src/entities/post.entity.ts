import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  DeleteDateColumn, 
  OneToMany, 
  Index, 
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { Comment } from './comment.entity';
import { UserProfile } from './user-profile.entity';

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => UserProfile)
  @JoinColumn({ name: 'authorId' })
  author!: UserProfile;

  @Column({ type: 'text' })
  content!: string;

  @OneToMany(() => Comment, (comment) => comment.post)
  comments!: Comment[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date;
}