import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  DeleteDateColumn 
} from 'typeorm';

@Entity('chats')
export class Chat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 'DIRECT' (1-on-1) or 'GROUP'
  @Column({ type: 'varchar', length: 20, default: 'DIRECT' })
  type: string; 

  // Only really used for GROUP chats (e.g., "Weekend Trip")
  @Column({ type: 'varchar', nullable: true })
  title: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}