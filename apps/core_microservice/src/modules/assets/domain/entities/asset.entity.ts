import { Entity, Column, Index } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';

@Entity('assets')
export class Asset extends TypeormEntityBase {
  @Index()
  @Column({ type: 'uuid' })
  uploaderId!: string;

  @Column({ type: 'varchar' })
  url!: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ type: 'int' })
  size!: number;

  // Factory wymuszająca poprawne utworzenie obiektu
  static create(props: {
    uploaderId: string;
    url: string;
    mimeType: string;
    size: number;
  }): Asset {
    const asset = new Asset();
    asset.uploaderId = props.uploaderId;
    asset.url = props.url;
    asset.mimeType = props.mimeType;
    asset.size = props.size;
    return asset;
  }
}
