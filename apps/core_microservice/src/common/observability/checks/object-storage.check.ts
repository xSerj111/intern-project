import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { HealthCheck } from '@repo/shared';
import { AppConfigService } from '../../../config/app-config.service';

const REQUEST_TIMEOUT_MS = 1000;

/**
 * Own client, so the check neither reaches into the storage adapter's private
 * client nor shares its retry policy: a probe must fail fast, not retry.
 */
@Injectable()
export class ObjectStorageCheck implements HealthCheck, OnModuleDestroy {
  readonly name = 'object_storage';
  readonly critical = false;

  private client?: S3Client;

  constructor(private readonly config: AppConfigService) {}

  async run(): Promise<void> {
    const { privateBucket } = this.config.s3;
    await this.getClient().send(
      new HeadBucketCommand({ Bucket: privateBucket }),
      {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  private getClient(): S3Client {
    if (!this.client) {
      const { endpoint, port, useSsl, region, accessKey, secretKey } =
        this.config.s3;
      this.client = new S3Client({
        endpoint: `${useSsl ? 'https' : 'http'}://${endpoint}:${port}`,
        region,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        forcePathStyle: true,
        maxAttempts: 1,
      });
    }
    return this.client;
  }
}
