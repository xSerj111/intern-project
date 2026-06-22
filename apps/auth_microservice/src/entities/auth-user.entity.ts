import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn,
  DeleteDateColumn
} from 'typeorm';

@Entity('auth_users')
export class AuthUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ default: false })
  isEmailVerified: boolean;

  // Optional roles array for future RBAC (Role-Based Access Control)
  @Column({ type: 'simple-array', nullable: true })
  roles: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Essential for the event-driven soft-delete strategy
  @DeleteDateColumn()
  deletedAt: Date;
}