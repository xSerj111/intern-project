export type UploadPurpose = 'post-image' | 'avatar' | 'chat-attachment';

export interface ICreateUploadRequest {
  purpose: UploadPurpose;
  /** Declared MIME type; must be in `UPLOAD_ALLOWLIST[purpose]`. */
  contentType: string;
  /** Bytes, 1..UPLOAD_MAX_BYTES. */
  size: number;
  /** At most 255 chars; stored sanitized. */
  fileName?: string;
}
