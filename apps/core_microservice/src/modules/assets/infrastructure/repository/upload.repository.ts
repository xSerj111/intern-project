import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Asset } from '../../domain/entities/asset.entity';
import type { IUploadRepository } from '../../domain/interfaces/upload-repository.port';

/** Upload lifecycle persistence; sees `PENDING` rows, unlike `AssetRepository`. */
@Injectable()
export class UploadRepository implements IUploadRepository {
  constructor(
    @InjectRepository(Asset) private readonly repository: Repository<Asset>,
  ) {}

  findById(id: string): Promise<Asset | null> {
    return this.repository.findOne({ where: { id } });
  }

  save(asset: Asset): Promise<Asset> {
    return this.repository.save(asset);
  }

  claimSweepable(limit: number, graceSec: number): Promise<Asset[]> {
    return this.repository.manager.transaction((tx) =>
      tx
        .createQueryBuilder(Asset, 'asset')
        // Literal predicate so IDX_assets_pending_expiry (WHERE status = 'PENDING') applies.
        .where(`asset.status = 'PENDING'`)
        .andWhere(
          `asset."expiresAt" < now() - make_interval(secs => :graceSec)`,
          { graceSec },
        )
        .orderBy('asset.expiresAt', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany(),
    );
  }

  async hardDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.repository.delete({ id: In(ids) });
  }
}
