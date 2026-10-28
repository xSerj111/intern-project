import { Inject, Injectable } from '@nestjs/common';
import { Counter, type Registry } from 'prom-client';
import { EntityByIdNotFoundError, LoggerKey, type Logger } from '@repo/shared';
import {
  UPLOAD_MAX_BYTES,
  type IAssetResponse,
  type ICreateUploadRequest,
  type IUploadTicket,
  type IUploadedAttachment,
  type UploadPurpose,
} from '@repo/contracts';
import { AppConfigService } from '../../config/app-config.service';
import { METRICS_REGISTRY } from '../../common/observability/metrics.tokens';
import { Asset } from './domain/entities/asset.entity';
import {
  UploadContentRejectedError,
  UploadExpiredError,
  UploadNotReadyError,
  UploadTooLargeError,
} from './domain/errors/asset.errors';
import {
  CONTENT_SNIFFER,
  type IContentSniffer,
} from './domain/interfaces/content-sniffer.port';
import {
  FileStoragePortKey,
  type IFileStoragePort,
} from './domain/interfaces/file-storage.port';
import {
  UPLOAD_REPOSITORY,
  type IUploadRepository,
} from './domain/interfaces/upload-repository.port';
import { AssetResponseDto } from './dto/asset-response.dto';

/** Bytes read from the object for content sniffing (FR-022). */
export const UPLOAD_SNIFF_BYTES = 4100;

const METRIC_NAME = 'uploads_total';

type UploadOutcome =
  'confirmed' | 'rejected_content' | 'rejected_size' | 'expired';

/** Purposes promoted to the public bucket on confirm. */
const PUBLIC_PURPOSES: readonly UploadPurpose[] = ['post-image', 'avatar'];

/** Public object extension, taken from the detected (not declared) type. */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export type ConfirmedUpload = IAssetResponse | IUploadedAttachment;

/**
 * Signed direct-to-storage uploads (research §10–11). Bytes never pass
 * through core: it signs the POST policy, then checks the stored object's
 * size and first bytes on confirm and promotes public purposes in storage.
 */
@Injectable()
export class UploadsService {
  private readonly uploads: Counter<'purpose' | 'outcome'>;

  constructor(
    @Inject(UPLOAD_REPOSITORY) private readonly repo: IUploadRepository,
    @Inject(FileStoragePortKey) private readonly storage: IFileStoragePort,
    @Inject(CONTENT_SNIFFER) private readonly sniffer: IContentSniffer,
    private readonly appConfig: AppConfigService,
    @Inject(METRICS_REGISTRY) registry: Registry,
    @Inject(LoggerKey) private readonly logger: Logger,
  ) {
    const existing = registry.getSingleMetric(METRIC_NAME);
    this.uploads =
      (existing as Counter<'purpose' | 'outcome'> | undefined) ??
      new Counter({
        name: METRIC_NAME,
        help: 'Upload confirmations by purpose and outcome',
        labelNames: ['purpose', 'outcome'],
        registers: [registry],
      });
  }

  async createUpload(
    sub: string,
    dto: ICreateUploadRequest,
  ): Promise<IUploadTicket> {
    const ttlSec = this.appConfig.uploads.linkTtlSec;
    const asset = Asset.createPending({
      uploaderId: sub,
      purpose: dto.purpose,
      declaredMime: dto.contentType,
      declaredSize: dto.size,
      bucket: this.appConfig.s3.privateBucket,
      fileName: dto.fileName,
      now: new Date(),
      ttlSec,
    });
    const saved = await this.repo.save(asset);

    const { url, fields } = await this.storage.presignPost({
      bucket: saved.bucket!,
      key: saved.storageKey!,
      contentType: saved.mimeType,
      maxBytes: UPLOAD_MAX_BYTES,
      expiresSec: ttlSec,
    });

    this.logger.info('Upload ticket issued', {
      props: { uploadId: saved.id, uploaderId: sub, purpose: dto.purpose },
    });

    return {
      uploadId: saved.id,
      url,
      fields,
      maxBytes: UPLOAD_MAX_BYTES,
      expiresAt: saved.expiresAt!.toISOString(),
    };
  }

  async confirm(sub: string, uploadId: string): Promise<ConfirmedUpload> {
    // 1. Unknown and foreign uploads look the same (no ownership leak).
    const asset = await this.repo.findById(uploadId);
    if (!asset || !asset.isOwnedBy(sub)) {
      throw new EntityByIdNotFoundError('assets', uploadId);
    }

    // 2. Confirming twice returns the same body.
    if (asset.status === 'READY') {
      return this.toResponse(asset);
    }

    const purpose = asset.purpose!;
    // 3. Owner, PENDING and not expired.
    try {
      asset.assertConfirmableBy(sub, new Date());
    } catch (error) {
      if (error instanceof UploadExpiredError) this.count(purpose, 'expired');
      throw error;
    }

    const bucket = asset.bucket!;
    const key = asset.storageKey!;

    // 4. The object must exist and be within the size limit.
    const head = await this.storage.head(bucket, key);
    if (!head) {
      throw new UploadNotReadyError();
    }
    try {
      asset.assertStoredSizeAcceptable(head.size);
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        await this.discard(asset, 'rejected_size');
      }
      throw error;
    }

    // 5–6. Sniff the first bytes; the declared type is only a hint. Reads and
    // copies are pinned to the ETag seen here: the signed POST can still
    // replace the pending object until it expires.
    const ifMatch = head.etag;
    const bytes = await this.storage.readHead(
      bucket,
      key,
      UPLOAD_SNIFF_BYTES,
      ifMatch,
    );
    const sniff = await this.sniffer.detect(bytes, asset.mimeType, purpose);
    if (!sniff.allowed) {
      await this.discard(asset, 'rejected_content');
      throw new UploadContentRejectedError();
    }
    const detectedMime = sniff.detectedMime ?? asset.mimeType;

    // 7. The checked bytes are copied to their final key inside storage (the
    // public bucket for public purposes), then the pending copy goes.
    const destKey = asset.publishedKey(EXTENSION_BY_MIME[detectedMime] ?? '');
    const copy = { contentType: detectedMime, ifMatch };
    let target: { bucket: string; key: string; url: string | null };
    if (PUBLIC_PURPOSES.includes(purpose)) {
      const url = await this.storage.copyToPublic(bucket, key, destKey, copy);
      target = { bucket: this.appConfig.s3.bucketName, key: destKey, url };
    } else {
      await this.storage.copyToPrivate(bucket, key, destKey, copy);
      target = { bucket, key: destKey, url: null };
    }
    await this.storage.deleteObject(bucket, key);

    // 8. READY; a failed save must not leave the copied object behind.
    asset.confirm({
      detectedMime,
      actualSize: head.size,
      bucket: target.bucket,
      key: target.key,
      url: target.url,
    });
    let saved: Asset;
    try {
      saved = await this.repo.save(asset);
    } catch (error) {
      await this.safeDelete(target.bucket, target.key);
      throw error;
    }

    this.count(purpose, 'confirmed');
    this.logger.info('Upload confirmed', {
      props: { uploadId: saved.id, uploaderId: sub, purpose },
    });
    return this.toResponse(saved);
  }

  /** Deletes the stored object and soft-deletes the row. */
  private async discard(asset: Asset, outcome: UploadOutcome): Promise<void> {
    await this.storage.deleteObject(asset.bucket!, asset.storageKey!);
    asset.reject();
    await this.repo.save(asset);
    this.count(asset.purpose!, outcome);
  }

  private async safeDelete(bucket: string, key: string): Promise<void> {
    try {
      await this.storage.deleteObject(bucket, key);
    } catch (error) {
      this.logger.warn('Failed to remove copied object after save failure', {
        props: { bucket, key, error: String(error) },
      });
    }
  }

  private count(purpose: UploadPurpose, outcome: UploadOutcome): void {
    this.uploads.inc({ purpose, outcome });
  }

  private toResponse(asset: Asset): ConfirmedUpload {
    if (asset.purpose === 'chat-attachment') {
      return {
        id: asset.id,
        mimeType: asset.mimeType,
        size: asset.size,
        originalName: asset.originalName ?? 'attachment',
      };
    }
    return new AssetResponseDto(asset);
  }
}
