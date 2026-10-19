import { Entity, Column, Index } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import { MissingStorageKeyError } from '../errors/asset.errors';

export type AssetVisibility = 'PUBLIC' | 'PRIVATE';

export const ASSET_ORIGINAL_NAME_MAX_LENGTH = 255;

// Strips control characters, then keeps only the last path segment.
function sanitizeOriginalName(name: string): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '');
  const base = cleaned.split(/[\\/]/).pop()?.trim() ?? '';
  if (base === '' || base === '.' || base === '..') return null;
  return base.slice(0, ASSET_ORIGINAL_NAME_MAX_LENGTH);
}

@Entity('assets')
export class Asset extends TypeormEntityBase {
  @Index()
  @Column({ type: 'uuid' })
  uploaderId!: string;

  // Public assets only. Private assets get presigned URLs on demand.
  @Column({ type: 'varchar', nullable: true })
  url!: string | null;

  @Column({ type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ type: 'int' })
  size!: number;

  @Column({ type: 'varchar', length: 10, default: 'PUBLIC' })
  visibility: AssetVisibility = 'PUBLIC';

  // Null for rows created before private storage (implicitly the public bucket).
  @Column({ type: 'varchar', length: 63, nullable: true })
  bucket!: string | null;

  // Object key. Required for PRIVATE assets.
  @Column({ type: 'varchar', length: 255, nullable: true })
  storageKey!: string | null;

  // Sanitized: path parts and control characters removed.
  @Column({ type: 'varchar', length: 255, nullable: true })
  originalName!: string | null;

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

  static createPrivate(props: {
    uploaderId: string;
    bucket: string;
    storageKey: string;
    mimeType: string;
    size: number;
    originalName: string;
  }): Asset {
    if (!props.storageKey || props.storageKey.trim() === '') {
      throw new MissingStorageKeyError();
    }
    const asset = new Asset();
    asset.uploaderId = props.uploaderId;
    asset.visibility = 'PRIVATE';
    asset.url = null;
    asset.bucket = props.bucket;
    asset.storageKey = props.storageKey;
    asset.mimeType = props.mimeType;
    asset.size = props.size;
    asset.originalName = sanitizeOriginalName(props.originalName);
    return asset;
  }

  softDelete(): void {
    this.deletedAt = new Date();
  }
}
