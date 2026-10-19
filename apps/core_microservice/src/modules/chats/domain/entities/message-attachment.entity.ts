import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { Message } from './message.entity';
import type { Asset } from '../../../assets/domain/entities/asset.entity';

@Entity('message_assets')
@Index(['messageId', 'assetId'], { unique: true })
export class MessageAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  messageId!: string;

  @ManyToOne('Message', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message!: Message;

  @Index('IDX_message_assets_assetId', { unique: true }) // one asset belongs to at most one message
  @Column({ type: 'uuid' })
  assetId!: string;

  @ManyToOne('Asset', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset;

  // The sender's order, starting at 0.
  @Column({ type: 'int', default: 0 })
  displayOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
