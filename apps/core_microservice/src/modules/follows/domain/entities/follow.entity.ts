import { TypeormEntityBase } from '@repo/shared';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  DeleteDateColumn,
  Unique,
} from 'typeorm';
import { FollowProps } from '../interfaces/follow.props';
import { FollowStatus } from '../enums/follow-status.enum';

@Entity('follows')
@Unique(['followerId', 'followingId'])
// @Index(['followerId', 'followingId'], { unique: true }) // Prevent duplicate follows
export class Follow extends TypeormEntityBase implements FollowProps {
  // Logical reference: The user who is initiating the follow
  @Index()
  @Column({ type: 'uuid' })
  followerId!: string;

  // Logical reference: The user being followed
  @Index()
  @Column({ type: 'uuid' })
  followingId!: string;

  @Column({
    type: 'enum',
    enum: FollowStatus,
    default: FollowStatus.ACCEPTED,
  })
  status!: FollowStatus;

  static create(props: FollowProps): Follow {
    const follow = new Follow();
    follow.followerId = props.followerId;
    follow.followingId = props.followingId;
    follow.status = props.status ?? FollowStatus.ACCEPTED;

    return follow;
  }
}
