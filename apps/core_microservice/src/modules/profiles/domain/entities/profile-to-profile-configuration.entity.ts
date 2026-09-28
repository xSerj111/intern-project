import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserProfile } from './user-profile.entity';

@Entity('profile_to_profile_configurations')
@Index(['actorId', 'targetId'], { unique: true }) // Prevent duplicate config rows between the same two users
export class ProfileToProfileConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // The profile who is setting the configuration
  @Column({ type: 'uuid' })
  actorId!: string;

  @ManyToOne(() => UserProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actorId', referencedColumnName: 'authUserId' })
  actor!: UserProfile;

  // The profile being targeted/configured
  @Column({ type: 'uuid' })
  targetId!: string;

  @ManyToOne(() => UserProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetId', referencedColumnName: 'authUserId' })
  target!: UserProfile;

  // --- Configuration Toggles ---

  @Column({ type: 'boolean', default: false })
  isMuted!: boolean;

  @Column({ type: 'boolean', default: false })
  isBlocked!: boolean;

  @Column({ type: 'boolean', default: false })
  isCloseFriend!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
