import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { UPLOAD_MAX_BYTES } from '@repo/contracts';
import {
  IFileStoragePort,
  PresignPostInput,
  PresignedPostResult,
  StorageCopyOptions,
  StorageObjectHead,
} from '../../domain/interfaces/file-storage.port';
import { UploadObjectChangedError } from '../../domain/errors/asset.errors';
import { AppConfigService } from '../../../../config/app-config.service';

/**
 * `attachment` Content-Disposition with an ASCII `filename` fallback and an
 * RFC 5987 `filename*` carrying the real (UTF-8) name.
 */
export function buildAttachmentDisposition(name: string): string {
  const fallback = Array.from(name, (ch) =>
    ch.codePointAt(0)! > 0x7e || ch.codePointAt(0)! < 0x20 ? '_' : ch,
  )
    .join('')
    .replace(/["\\]/g, '\\$&');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@Injectable()
export class S3StorageAdapter implements IFileStoragePort {
  private readonly s3Client: S3Client;
  // Signs browser-facing URLs against `s3.publicEndpoint`.
  private readonly presignClient: S3Client;
  private readonly bucketName: string;
  private readonly privateBucket: string;
  // Browser-facing base URL (scheme, host, port) for public object URLs.
  private readonly publicBaseUrl: string;
  private readonly logger = new Logger(S3StorageAdapter.name);

  constructor(private readonly appConfig: AppConfigService) {
    const {
      endpoint,
      port,
      useSsl,
      region,
      bucketName,
      privateBucket,
      publicEndpoint,
      accessKey,
      secretKey,
    } = this.appConfig.s3;

    this.bucketName = bucketName;
    this.privateBucket = privateBucket;

    const protocol = useSsl ? 'https' : 'http';
    const endpointUrl = `${protocol}://${endpoint}:${port}`;

    this.s3Client = new S3Client({
      endpoint: endpointUrl,
      region: region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });

    // A public endpoint may be a bare host (same port/scheme) or a full URL.
    const publicUrl = publicEndpoint.includes('://')
      ? publicEndpoint
      : `${protocol}://${publicEndpoint}:${port}`;
    this.publicBaseUrl = publicUrl.replace(/\/+$/, '');

    this.presignClient = new S3Client({
      endpoint: publicUrl,
      region: region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }

  async presignGet(
    key: string,
    options: { ttlSeconds: number; downloadName?: string },
  ): Promise<string> {
    const { ttlSeconds, downloadName } = options;
    try {
      const command = new GetObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        ResponseContentDisposition: downloadName
          ? buildAttachmentDisposition(downloadName)
          : undefined,
      });

      return await getSignedUrl(this.presignClient, command, {
        expiresIn: ttlSeconds,
      });
    } catch (error) {
      this.logger.error(
        `Failed to presign S3 URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
      );
      throw new InternalServerErrorException('Error signing storage URL');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: this.privateBucket, Key: key }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete file from S3: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
      );
      throw new InternalServerErrorException(
        'Error deleting file from storage',
      );
    }
  }

  async presignPost(input: PresignPostInput): Promise<PresignedPostResult> {
    const { bucket, key, contentType } = input;
    const maxBytes = Math.min(Math.floor(input.maxBytes), UPLOAD_MAX_BYTES);
    if (!(maxBytes >= 1) || !key || key.includes('${filename}')) {
      // `${filename}` would make the SDK sign a starts-with key condition.
      throw new InternalServerErrorException('Invalid upload policy input');
    }
    try {
      const { url, fields } = await createPresignedPost(this.presignClient, {
        Bucket: bucket,
        Key: key,
        Fields: { 'Content-Type': contentType },
        Conditions: [
          { bucket },
          { key },
          ['content-length-range', 1, maxBytes],
          { 'Content-Type': contentType },
        ],
        Expires: input.expiresSec ?? this.appConfig.uploads.linkTtlSec,
      });
      return { url, fields };
    } catch (error) {
      this.logError('Failed to presign S3 POST', error);
      throw new InternalServerErrorException('Error signing storage URL');
    }
  }

  async head(bucket: string, key: string): Promise<StorageObjectHead | null> {
    try {
      const out = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        size: out.ContentLength ?? 0,
        contentType: out.ContentType,
        etag: out.ETag,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      this.logError('Failed to read S3 object metadata', error);
      throw new InternalServerErrorException('Error reading storage object');
    }
  }

  async readHead(
    bucket: string,
    key: string,
    bytes: number,
    ifMatch?: string,
  ): Promise<Buffer> {
    const limit = Math.floor(bytes);
    if (!(limit >= 1)) return Buffer.alloc(0);
    try {
      const out = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=0-${limit - 1}`,
          IfMatch: ifMatch,
        }),
      );
      return await readAtMost(out.Body, limit);
    } catch (error) {
      if (isPreconditionFailed(error)) throw new UploadObjectChangedError();
      this.logError('Failed to read S3 object head', error);
      throw new InternalServerErrorException('Error reading storage object');
    }
  }

  async copyToPublic(
    srcBucket: string,
    srcKey: string,
    destKey: string,
    options: StorageCopyOptions = {},
  ): Promise<string> {
    await this.copy(srcBucket, srcKey, this.bucketName, destKey, options);
    return this.buildPublicUrl(destKey);
  }

  async copyToPrivate(
    srcBucket: string,
    srcKey: string,
    destKey: string,
    options: StorageCopyOptions = {},
  ): Promise<void> {
    await this.copy(srcBucket, srcKey, this.privateBucket, destKey, options);
  }

  private async copy(
    srcBucket: string,
    srcKey: string,
    destBucket: string,
    destKey: string,
    { contentType, ifMatch }: StorageCopyOptions,
  ): Promise<void> {
    try {
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: destKey,
          CopySource: `${srcBucket}/${srcKey.split('/').map(encodeURIComponent).join('/')}`,
          CopySourceIfMatch: ifMatch,
          ...(contentType
            ? {
                ContentType: contentType,
                MetadataDirective: 'REPLACE' as const,
              }
            : {}),
        }),
      );
    } catch (error) {
      if (isPreconditionFailed(error)) throw new UploadObjectChangedError();
      this.logError(`Failed to copy S3 object to ${destBucket}`, error);
      throw new InternalServerErrorException('Error copying storage object');
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (error) {
      if (isNotFound(error)) return;
      this.logError('Failed to delete file from S3', error);
      throw new InternalServerErrorException(
        'Error deleting file from storage',
      );
    }
  }

  private logError(message: string, error: unknown): void {
    this.logger.error(
      `${message}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error,
    );
  }

  private buildPublicUrl(fileKey: string): string {
    return `${this.publicBaseUrl}/${this.bucketName}/${fileKey}`;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NotFound' ||
    e.name === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  );
}

function isPreconditionFailed(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'PreconditionFailed' || e.$metadata?.httpStatusCode === 412;
}

/**
 * Reads a response body up to `limit` bytes, then stops and destroys the
 * stream, so a server that ignores `Range` cannot make us buffer the object.
 */
async function readAtMost(body: unknown, limit: number): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (!isAsyncIterable(body)) {
    throw new Error('Unsupported S3 response body');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
          ? Buffer.from(chunk)
          : Buffer.from(chunk as Uint8Array);
      const take = Math.min(buf.length, limit - total);
      chunks.push(take === buf.length ? buf : buf.subarray(0, take));
      total += take;
      if (total >= limit) break;
    }
  } finally {
    const destroy = (body as { destroy?: () => void }).destroy;
    if (typeof destroy === 'function') destroy.call(body);
  }
  return Buffer.concat(chunks, total);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === 'function'
  );
}
