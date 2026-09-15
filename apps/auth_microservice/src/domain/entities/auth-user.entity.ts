import { Column, Entity } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';

@Entity('auth_users')
export class AuthUser extends TypeormEntityBase {
  @Column({ unique: true })
  email!: string;

  @Column({ nullable: true })
  passwordHash?: string;

  @Column({ nullable: true, unique: true })
  googleId?: string;

  @Column({ default: false })
  isEmailVerified!: boolean;

  // Optional roles array for future RBAC (Role-Based Access Control)
  @Column({ type: 'simple-array', nullable: true })
  roles?: string[];
}
