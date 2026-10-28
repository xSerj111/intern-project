import { Injectable, Inject } from '@nestjs/common';
import {
  FileStoragePortKey,
  type IFileStoragePort,
} from './domain/interfaces/file-storage.port';
import { AssetRepository } from './infrastructure/repository/asset.repository';
import type { EntityManager } from 'typeorm';
import { Asset } from './domain/entities/asset.entity';

@Injectable()
export class AssetsService {
  constructor(
    @Inject(FileStoragePortKey) private readonly fileStorage: IFileStoragePort,
    private readonly assetRepository: AssetRepository,
  ) {}

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
