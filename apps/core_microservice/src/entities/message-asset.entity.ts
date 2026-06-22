import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn, 
  Index 
} from 'typeorm';
import { Message } from './message.entity';
import { Asset } from './asset.entity';

@Entity('message_assets')
@Index(['messageId', 'assetId'], { unique: true })
export class MessageAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  messageId!: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message!: Message;

  @Column({ type: 'uuid' })
  assetId!: string;

  @ManyToOne(() => Asset, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset;

  @Column({ type: 'int', default: 0 })
  displayOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}