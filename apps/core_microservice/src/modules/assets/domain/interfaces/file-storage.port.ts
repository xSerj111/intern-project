export const FileStoragePortKey = Symbol.for('IFileStoragePort');

export interface IFileStoragePort {
  /**
   * Returns a short-lived signed GET URL for an object in the private bucket.
   * With `downloadName` it sets `Content-Disposition: attachment`.
   */
  presignGet(
    key: string,
    options: { ttlSeconds: number; downloadName?: string },
  ): Promise<string>;

  /** Deletes an object from the private bucket. */
  delete(key: string): Promise<void>;

  /**
   * Presigned POST for a direct browser upload. The policy pins the bucket,
   * the exact key, `content-length-range [1, maxBytes]` (capped at
   * `UPLOAD_MAX_BYTES`) and the exact `Content-Type`.
   */
  presignPost(input: PresignPostInput): Promise<PresignedPostResult>;

  /** Object metadata, or `null` when the object does not exist. */
  head(bucket: string, key: string): Promise<StorageObjectHead | null>;

  /**
   * First `bytes` bytes of the object (ranged GET); never returns more. With
   * `ifMatch` the read fails with `UploadObjectChangedError` unless the
   * object still has that ETag.
   */
  readHead(
    bucket: string,
    key: string,
    bytes: number,
    ifMatch?: string,
  ): Promise<Buffer>;

  /**
   * Server-side copy into the public bucket under `destKey`; returns the
   * public URL. See `StorageCopyOptions`.
   */
  copyToPublic(
    srcBucket: string,
    srcKey: string,
    destKey: string,
    options?: StorageCopyOptions,
  ): Promise<string>;

  /** Server-side copy into the private bucket under `destKey`. */
  copyToPrivate(
    srcBucket: string,
    srcKey: string,
    destKey: string,
    options?: StorageCopyOptions,
  ): Promise<void>;

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
  /** Pins later reads and copies to exactly this version of the object. */
  etag?: string;
}

export interface StorageCopyOptions {
  /** Replaces the copy's metadata with this content type. */
  contentType?: string;
  /** Copy only if the source still has this ETag, else `UploadObjectChangedError`. */
  ifMatch?: string;
}
