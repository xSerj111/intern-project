import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { IFileStoragePort } from '../../domain/interfaces/file-storage.port';
import { AppConfigService } from '../../../../config/app-config.service';
import * as crypto from 'crypto';
import * as path from 'path';

@Injectable()
export class S3StorageAdapter implements IFileStoragePort {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(S3StorageAdapter.name);

  constructor(private readonly appConfig: AppConfigService) {
    const { endpoint, port, useSsl, region, bucketName, accessKey, secretKey } =
      this.appConfig.s3;

    this.bucketName = bucketName;

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

  private buildPublicUrl(fileKey: string): string {
    // ⬅️ ZMIANA: Pobieramy dane z naszego serwisu w 1 linijce
    const { endpoint, port, useSsl, bucketName } = this.appConfig.s3;
    const protocol = useSsl ? 'https' : 'http';

    return `${protocol}://${endpoint}:${port}/${bucketName}/${fileKey}`;
  }
}
