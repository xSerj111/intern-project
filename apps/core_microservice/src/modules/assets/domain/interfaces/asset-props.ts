export interface AssetProps {
  id: string;
  uploaderId: string;
  /** Public assets only. */
  url: string | null;
  mimeType: string;
  size: number;
  visibility: 'PUBLIC' | 'PRIVATE';
  /** Null for existing public rows. */
  bucket: string | null;
  /** Required for `PRIVATE`. */
  storageKey: string | null;
  /** Sanitized: path parts and control characters removed. */
  originalName: string | null;
  /** `PENDING` until a signed upload is confirmed. */
  status: 'PENDING' | 'READY';
  /** Null for legacy rows. */
  purpose: 'post-image' | 'avatar' | 'chat-attachment' | null;
  /** Signed-upload expiry; set only while `PENDING`. */
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
