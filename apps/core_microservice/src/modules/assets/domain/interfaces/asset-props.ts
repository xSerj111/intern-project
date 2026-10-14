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
  createdAt: Date;
  updatedAt: Date;
}
