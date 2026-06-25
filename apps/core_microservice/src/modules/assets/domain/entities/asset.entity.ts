import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // The actual CDN link or storage path
  @Column({ type: 'varchar' })
  url!: string;

  // e.g., 'IMAGE', 'VIDEO', 'DOCUMENT'
  @Column({ type: 'varchar', length: 50 })
  type!: string;

  // e.g., 'image/jpeg', 'video/mp4' (useful for frontend rendering rules)
  @Column({ type: 'varchar', length: 100, nullable: true })
  mimeType?: string;

  // File size in bytes (useful for storage quotas and analytics)
  @Column({ type: 'int', nullable: true })
  size?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date;
}
