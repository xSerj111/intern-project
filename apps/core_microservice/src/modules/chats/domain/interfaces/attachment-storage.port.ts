import 'multer';
import type { ChatTransaction } from './chat-repository.port';

/** Presigned attachment URLs live 15 minutes (FR-027). */
export const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;

export type AttachmentKind = 'image' | 'video' | 'file';

/** `image/*` and `video/*` preview inline; everything else is a download. */
export function attachmentKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

/** The slice of a stored asset the chats module needs. */
export interface StoredAttachment {
  id: string;
  uploaderId: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  storageKey: string | null;
  mimeType: string;
  size: number;
  originalName: string | null;
}

export interface PresignableAttachment {
  storageKey: string;
  mimeType: string;
  originalName: string | null;
}

export interface PresignedAttachmentUrl {
  url: string;
  expiresAt: Date;
}

/** Private attachment storage (asset rows + objects), owned by the assets module. */
export interface IAttachmentStoragePort {
  /** Stores the file privately and records the uploader. */
  upload(
    uploaderId: string,
    file: Express.Multer.File,
  ): Promise<StoredAttachment>;
  /** Live (not soft-deleted) assets among `ids`; missing ids are absent. */
  findAssets(ids: string[], tx?: ChatTransaction): Promise<StoredAttachment[]>;
  /** Soft-deletes the asset rows inside the caller's transaction. */
  softDeleteAssets(ids: string[], tx: ChatTransaction): Promise<void>;
  /**
   * Short-lived GET URL (`ATTACHMENT_URL_TTL_SECONDS`); non-media types get a
   * download file name.
   */
  presign(asset: PresignableAttachment): Promise<PresignedAttachmentUrl>;
  /** Deletes the objects; rejects if any delete failed (after trying all). */
  deleteObjects(keys: string[]): Promise<void>;
}

export const ATTACHMENT_STORAGE_PORT = Symbol.for('IAttachmentStoragePort');
