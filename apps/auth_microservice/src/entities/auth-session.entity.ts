import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { AuthUser } from "./auth-user.entity";

@Entity('auth-sessions')
export class AuthSession {
  @PrimaryGeneratedColumn()
  id: string;

  @Column()
  refreshToken: string;

  @Column()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => AuthUser)
  user: AuthUser;


}