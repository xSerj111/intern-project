export const FileStoragePortKey = Symbol.for('IFileStoragePort');

export interface IFileStoragePort {
  /**
   * Zwraca krótkotrwały podpisany URL GET do obiektu z prywatnego bucketu.
   * Z `downloadName` ustawia `Content-Disposition: attachment`.
   */
  presignGet(
    key: string,
    options: { ttlSeconds: number; downloadName?: string },
  ): Promise<string>;

  /** Usuwa obiekt z prywatnego bucketu. */
  delete(key: string): Promise<void>;

  /**
   * Presigned POST for a direct browser upload. The policy pins the bucket,
   * the exact key, `content-length-range [1, maxBytes]` (capped at
   * `UPLOAD_MAX_BYTES`) and the exact `Content-Type`.
   */
  presignPost(input: PresignPostInput): Promise<PresignedPostResult>;

  /** Object metadata, or `null` when the object does not exist. */
  head(bucket: string, key: string): Promise<StorageObjectHead | null>;

  /** First `bytes` bytes of the object (ranged GET); never returns more. */
  readHead(bucket: string, key: string, bytes: number): Promise<Buffer>;

  /**
   * Server-side copy into the public bucket under `destKey`; returns the
   * public URL. With `contentType` the copy's metadata is replaced.
   */
  copyToPublic(
    srcBucket: string,
    srcKey: string,
    destKey: string,
    contentType?: string,
  ): Promise<string>;

  /** Deletes an object from any bucket; a missing object is not an error. */
  deleteObject(bucket: string, key: string): Promise<void>;
}

export interface PresignPostInput {
  bucket: string;
  key: string;
  contentType: string;
  maxBytes: number;
  /** Policy lifetime; defaults to `uploads.linkTtlSec`. */
  expiresSec?: number;
}

export interface PresignedPostResult {
  url: string;
  fields: Record<string, string>;
}

export interface StorageObjectHead {
  size: number;
  contentType?: string;
}
