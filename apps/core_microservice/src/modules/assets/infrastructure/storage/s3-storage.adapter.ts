import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IFileStoragePort } from '../../domain/interfaces/file-storage.port';
import { AppConfigService } from '../../../../config/app-config.service';
import * as crypto from 'crypto';
import * as path from 'path';

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

  async upload(
    file: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    try {
      const extension = path.extname(filename);
      const uniqueFilename = `${crypto.randomUUID()}${extension}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: uniqueFilename,
        Body: file,
        ContentType: mimeType,
      });

      await this.s3Client.send(command);

      return this.buildPublicUrl(uniqueFilename);
    } catch (error) {
      this.logger.error(
        `Failed to upload file to S3: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
      );
      throw new InternalServerErrorException('Error uploading file to storage');
    }
  }

  async uploadPrivate(
    file: Buffer,
    key: string,
    mimeType?: string,
  ): Promise<void> {
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.privateBucket,
          Key: key,
          Body: file,
          ContentType: mimeType,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to upload private file to S3: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
      );
      throw new InternalServerErrorException('Error uploading file to storage');
    }
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

  private buildPublicUrl(fileKey: string): string {
    const { endpoint, port, useSsl, bucketName } = this.appConfig.s3;
    const protocol = useSsl ? 'https' : 'http';

    return `${protocol}://${endpoint}:${port}/${bucketName}/${fileKey}`;
  }
}
