import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';
import 'multer';
import {
  FileStoragePortKey,
  type IFileStoragePort,
} from './domain/interfaces/file-storage.port';
import { AssetRepository } from './infrastructure/repository/asset.repository';
import type { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';
import { Asset } from './domain/entities/asset.entity';

@Injectable()
export class AssetsService {
  constructor(
    @Inject(FileStoragePortKey) private readonly fileStorage: IFileStoragePort,
    private readonly assetRepository: AssetRepository,
    private readonly appConfig: AppConfigService,
    @Inject(LoggerKey) private readonly logger: Logger,
  ) {}

  async uploadAsset(
    uploaderId: string,
    file: Express.Multer.File,
  ): Promise<Asset> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const url = await this.fileStorage.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    const asset = Asset.create({
      uploaderId,
      url,
      mimeType: file.mimetype,
      size: file.size,
    });

    const savedAsset = await this.assetRepository.save(asset);

    this.logger.info('Asset uploaded successfully', {
      props: { assetId: savedAsset.id, uploaderId },
    });

    return savedAsset;
  }

  /** Stores the file in the private bucket under `chat/{uploaderId}/{uuid}`. */
  async uploadPrivate(
    uploaderId: string,
    file: Express.Multer.File,
  ): Promise<Asset> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const storageKey = `chat/${uploaderId}/${randomUUID()}`;
    await this.fileStorage.uploadPrivate(
      file.buffer,
      storageKey,
      file.mimetype,
    );

    const asset = Asset.createPrivate({
      uploaderId,
      bucket: this.appConfig.s3.privateBucket,
      storageKey,
      mimeType: file.mimetype,
      size: file.size,
      originalName: file.originalname,
    });

    let savedAsset: Asset;
    try {
      savedAsset = await this.assetRepository.save(asset);
    } catch (error) {
      // Don't leave an orphaned object behind when the row was never stored.
      try {
        await this.fileStorage.delete(storageKey);
      } catch (cleanupError) {
        this.logger.warn('Failed to remove orphaned private object', {
          props: { storageKey, error: String(cleanupError) },
        });
      }
      throw error;
    }

    this.logger.info('Private asset uploaded successfully', {
      props: { assetId: savedAsset.id, uploaderId },
    });

    return savedAsset;
  }

  findByIds(ids: string[], tx?: EntityManager): Promise<Asset[]> {
    return this.assetRepository.findByIds(ids, tx);
  }

  softDeleteMany(ids: string[], tx?: EntityManager): Promise<void> {
    return this.assetRepository.softDeleteMany(ids, tx);
  }

  /** Presigned GET URL for a private object; the caller picks the TTL. */
  presignGet(
    storageKey: string,
    options: { ttlSeconds: number; downloadName?: string },
  ): Promise<string> {
    return this.fileStorage.presignGet(storageKey, options);
  }

  /** Deletes a private object from storage (the asset row is untouched). */
  deleteObject(storageKey: string): Promise<void> {
    return this.fileStorage.delete(storageKey);
  }
}
