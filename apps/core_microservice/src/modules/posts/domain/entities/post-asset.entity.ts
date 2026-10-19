import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { Post } from './post.entity';
import type { Asset } from '../../../assets/domain/entities/asset.entity';

@Entity('post_assets')
@Index(['postId', 'assetId'], { unique: true }) // Prevent mapping the exact same image to the same post twice
export class PostAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  postId!: string;

  @ManyToOne('Post', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post!: Post;

  @Column({ type: 'uuid' })
  assetId!: string;

  @ManyToOne('Asset', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset;

  // Critical for carousels: keeps images in the exact order the user selected them
  @Column({ type: 'int', default: 0 })
  displayOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
