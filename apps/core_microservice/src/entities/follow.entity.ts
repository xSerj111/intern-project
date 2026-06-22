import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  Index,
  DeleteDateColumn
} from 'typeorm';

@Entity('follows')
@Index(['followerId', 'followingId'], { unique: true }) // Prevent duplicate follows
export class Follow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Logical reference: The user who is initiating the follow
  @Index()
  @Column({ type: 'uuid' })
  followerId!: string;

  // Logical reference: The user being followed
  @Index()
  @Column({ type: 'uuid' })
  followingId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  // Allows preserving historical follow data while visually "unfollowing"
  @DeleteDateColumn()
  deletedAt!: Date;
}