import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AuthUser } from './auth-user.entity';

@Entity('auth_sessions')
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  refreshToken!: string;

  @Column()
  expiresAt!: Date;
  
  // Added security tracking fields
  @Column({ type: 'varchar', nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', nullable: true })
  userAgent?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => AuthUser, { onDelete: 'CASCADE'})
  @JoinColumn({ name: 'userId' }) // Explicitly names the DB column 'userId'
  user!: AuthUser;
}