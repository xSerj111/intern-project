import { Inject, Injectable } from '@nestjs/common';
import 'multer';
import { AssetsService } from '../../../assets/assets.service';
import {
  CACHE_STORE,
  type ICacheStore,
} from '../../../../common/cache/cache-store.port';
import {
  SIGNED_URL_TTL_SEC,
  signedUrlKey,
} from '../../../../common/cache/cache-keys';
import type { Asset } from '../../../assets/domain/entities/asset.entity';
import type { ChatTransaction } from '../../domain/interfaces/chat-repository.port';
import {
  ATTACHMENT_URL_TTL_SECONDS,
  attachmentKind,
  type IAttachmentStoragePort,
  type PresignableAttachment,
  type PresignedAttachmentUrl,
  type StoredAttachment,
} from '../../domain/interfaces/attachment-storage.port';

/** Cache key variants; the file name is fixed per asset, so it is not part of the key. */
const DISPOSITIONS = ['inline', 'attachment'] as const;

interface CachedSignedUrl {
  url: string;
  /** ISO string once round-tripped through the cache. */
  expiresAt: string | Date;
}

function toStored(asset: Asset): StoredAttachment {
  return {
    id: asset.id,
    uploaderId: asset.uploaderId,
    visibility: asset.visibility,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    size: asset.size,
    originalName: asset.originalName,
  };
}

/** Attachment storage over the assets module's private bucket. */
@Injectable()
export class AttachmentStorageAdapter implements IAttachmentStoragePort {
  constructor(
    private readonly assets: AssetsService,
    @Inject(CACHE_STORE) private readonly cache: ICacheStore,
  ) {}

  async upload(
    uploaderId: string,
    file: Express.Multer.File,
  ): Promise<StoredAttachment> {
    return toStored(await this.assets.uploadPrivate(uploaderId, file));
  }

  async findAssets(
    ids: string[],
    tx?: ChatTransaction,
  ): Promise<StoredAttachment[]> {
    if (ids.length === 0) return [];
    const assets = await this.assets.findByIds(ids, tx);
    return assets.map(toStored);
  }

  async softDeleteAssets(ids: string[], tx: ChatTransaction): Promise<void> {
    if (ids.length === 0) return;
    await this.assets.softDeleteMany(ids, tx);
  }

  async presign(asset: PresignableAttachment): Promise<PresignedAttachmentUrl> {
    const downloadName =
      attachmentKind(asset.mimeType) === 'file'
        ? (asset.originalName ?? 'attachment')
        : undefined;
    const key = signedUrlKey(
      asset.id,
      downloadName === undefined ? 'inline' : 'attachment',
    );

    const cached = await this.cache.get<CachedSignedUrl>(key);
    if (cached) {
      const expiresAt = new Date(cached.expiresAt);
      const remainingMs = expiresAt.getTime() - Date.now();
      if (remainingMs >= (ATTACHMENT_URL_TTL_SECONDS * 1000) / 2) {
        return { url: cached.url, expiresAt };
      }
    }

    // Taken before signing so the reported expiry is never later than the real one.
    const expiresAt = new Date(Date.now() + ATTACHMENT_URL_TTL_SECONDS * 1000);
    const url = await this.assets.presignGet(asset.storageKey, {
      ttlSeconds: ATTACHMENT_URL_TTL_SECONDS,
      downloadName,
    });
    await this.cache.set<CachedSignedUrl>(
      key,
      { url, expiresAt: expiresAt.toISOString() },
      SIGNED_URL_TTL_SEC,
    );
    return { url, expiresAt };
  }

  async invalidateSignedUrls(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;
    await this.cache.del(
      ...assetIds.flatMap((id) => DISPOSITIONS.map((d) => signedUrlKey(id, d))),
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    const results = await Promise.allSettled(
      keys.map((key) => this.assets.deleteObject(key)),
    );
    const failed = keys.filter((_, i) => results[i].status === 'rejected');
    if (failed.length > 0) {
      throw new Error(
        `Failed to delete ${failed.length} of ${keys.length} objects: ${failed.join(', ')}`,
      );
    }
  }
}
