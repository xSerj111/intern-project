import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', unique: true })
  authUserId: string;

  @Column({ type: "varchar", length: 50, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 100 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}