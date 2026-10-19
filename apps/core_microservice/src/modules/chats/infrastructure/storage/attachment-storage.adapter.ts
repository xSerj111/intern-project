import { Injectable } from '@nestjs/common';
import 'multer';
import { AssetsService } from '../../../assets/assets.service';
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
  constructor(private readonly assets: AssetsService) {}

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
    // Taken before signing so the reported expiry is never later than the real one.
    const expiresAt = new Date(Date.now() + ATTACHMENT_URL_TTL_SECONDS * 1000);
    const downloadName =
      attachmentKind(asset.mimeType) === 'file'
        ? (asset.originalName ?? 'attachment')
        : undefined;
    const url = await this.assets.presignGet(asset.storageKey, {
      ttlSeconds: ATTACHMENT_URL_TTL_SECONDS,
      downloadName,
    });
    return { url, expiresAt };
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
