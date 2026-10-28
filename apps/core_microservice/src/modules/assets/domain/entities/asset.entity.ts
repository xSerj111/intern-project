import { randomUUID } from 'node:crypto';
import { Entity, Column, Index } from 'typeorm';
import { EntityByIdNotFoundError, TypeormEntityBase } from '@repo/shared';
import {
  UPLOAD_ALLOWLIST,
  UPLOAD_MAX_BYTES,
  type UploadPurpose,
} from '@repo/contracts';
import {
  AssetNotAttachableError,
  MissingStorageKeyError,
  UploadExpiredError,
  UploadNotPendingError,
  UploadNotReadyError,
  UploadTooLargeError,
  UploadTypeNotAllowedError,
} from '../errors/asset.errors';

export type AssetVisibility = 'PUBLIC' | 'PRIVATE';
export type AssetStatus = 'PENDING' | 'READY';
export type AttachTarget = 'post' | 'avatar' | 'message';

/** Clock-skew allowance after `expiresAt` during which a confirm still succeeds. */
export const UPLOAD_CONFIRM_GRACE_SEC = 60;

/** Purposes whose assets become PUBLIC on confirm. */
const PUBLIC_PURPOSES: readonly UploadPurpose[] = ['post-image', 'avatar'];

/** Upload purposes each attach target accepts. */
const ATTACHABLE_PURPOSES: Record<AttachTarget, readonly UploadPurpose[]> = {
  post: ['post-image'],
  avatar: ['avatar', 'post-image'],
  message: ['chat-attachment'],
};

/** Visibility legacy (null-purpose) rows need per target, as before uploads had a purpose. */
const LEGACY_VISIBILITY: Record<AttachTarget, AssetVisibility> = {
  post: 'PUBLIC',
  avatar: 'PUBLIC',
  message: 'PRIVATE',
};

function assertSizeInRange(size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > UPLOAD_MAX_BYTES) {
    throw new UploadTooLargeError(UPLOAD_MAX_BYTES);
  }
}

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

  // Rows created outside the signed-upload flow are READY from the start.
  @Column({ type: 'varchar', length: 16, default: 'READY' })
  status: AssetStatus = 'READY';

  // Null for legacy rows.
  @Column({ type: 'varchar', length: 32, nullable: true })
  purpose!: UploadPurpose | null;

  // Signed-upload expiry; set only while PENDING.
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  // Factory that forces the object to be created correctly
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

  /**
   * A not-yet-uploaded asset in the private bucket, uploaded under `pending/`.
   * Confirm copies the checked bytes to a final key (`publishedKey`), because
   * the signed POST stays reusable on the pending key until it expires.
   */
  static createPending(props: {
    uploaderId: string;
    purpose: UploadPurpose;
    declaredMime: string;
    declaredSize: number;
    bucket: string;
    fileName?: string;
    now: Date;
    ttlSec: number;
  }): Asset {
    assertSizeInRange(props.declaredSize);
    if (!UPLOAD_ALLOWLIST[props.purpose].includes(props.declaredMime)) {
      throw new UploadTypeNotAllowedError(props.declaredMime, props.purpose);
    }
    const asset = new Asset();
    asset.id = randomUUID();
    asset.uploaderId = props.uploaderId;
    asset.purpose = props.purpose;
    asset.status = 'PENDING';
    asset.visibility = 'PRIVATE';
    asset.url = null;
    asset.bucket = props.bucket;
    asset.storageKey = `pending/${props.uploaderId}/${asset.id}`;
    asset.mimeType = props.declaredMime;
    asset.size = props.declaredSize;
    asset.originalName =
      props.fileName === undefined
        ? null
        : sanitizeOriginalName(props.fileName);
    asset.expiresAt = new Date(props.now.getTime() + props.ttlSec * 1000);
    return asset;
  }

  /**
   * Key the confirmed object lives under: `{id}{ext}` in the public bucket, or
   * `chat/{uploaderId}/{id}` in the private bucket for chat attachments.
   */
  publishedKey(extension: string): string {
    return this.purpose === 'chat-attachment'
      ? `chat/${this.uploaderId}/${this.id}`
      : `${this.id}${extension}`;
  }

  /** True when `userId` uploaded this asset. */
  isOwnedBy(userId: string): boolean {
    return this.uploaderId === userId;
  }

  /**
   * Owner, PENDING and not past `expiresAt` plus the clock-skew grace. A foreign
   * owner gets the same not-found as an unknown id, so ownership doesn't leak.
   */
  assertConfirmableBy(userId: string, now: Date): void {
    if (!this.isOwnedBy(userId)) {
      throw new EntityByIdNotFoundError('assets', this.id);
    }
    if (this.status !== 'PENDING') {
      throw new UploadNotPendingError();
    }
    if (
      !this.expiresAt ||
      now.getTime() > this.expiresAt.getTime() + UPLOAD_CONFIRM_GRACE_SEC * 1000
    ) {
      throw new UploadExpiredError();
    }
  }

  /** Checks the stored object's real size, before any content is read. */
  assertStoredSizeAcceptable(actualSize: number): void {
    assertSizeInRange(actualSize);
  }

  confirm(props: {
    detectedMime: string;
    actualSize: number;
    bucket: string;
    key: string;
    url: string | null;
  }): void {
    if (this.status !== 'PENDING') {
      throw new UploadNotPendingError();
    }
    this.status = 'READY';
    this.mimeType = props.detectedMime;
    this.size = props.actualSize;
    this.bucket = props.bucket;
    this.storageKey = props.key;
    this.url = props.url;
    if (this.purpose !== null && PUBLIC_PURPOSES.includes(this.purpose)) {
      this.visibility = 'PUBLIC';
    }
    this.expiresAt = null;
  }

  /** Bad content or size at confirm: the row is soft-deleted. */
  reject(): void {
    if (this.status !== 'PENDING') {
      throw new UploadNotPendingError();
    }
    this.softDelete();
  }

  assertAttachableTo(target: AttachTarget, userId: string): void {
    if (this.status !== 'READY') {
      throw new UploadNotReadyError();
    }
    if (!this.isOwnedBy(userId)) {
      throw new AssetNotAttachableError(target);
    }
    const fits =
      this.purpose === null
        ? this.visibility === LEGACY_VISIBILITY[target]
        : ATTACHABLE_PURPOSES[target].includes(this.purpose);
    if (!fits) {
      throw new AssetNotAttachableError(target);
    }
  }

  /** PENDING and expired for longer than `graceSec`. */
  isSweepable(now: Date, graceSec: number): boolean {
    return (
      this.status === 'PENDING' &&
      this.expiresAt !== null &&
      this.expiresAt.getTime() + graceSec * 1000 < now.getTime()
    );
  }
}
