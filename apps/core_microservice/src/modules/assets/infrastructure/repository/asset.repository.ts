import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { TypeormRepositoryBase } from '@repo/shared';
import { Asset } from '../../domain/entities/asset.entity';

@Injectable()
export class AssetRepository extends TypeormRepositoryBase<Asset, any> {
  public static readonly entity = Asset;
  protected relations: string[] = [];

  constructor(@InjectRepository(Asset) repository: Repository<Asset>) {
    super(repository);
  }

  /**
   * Live (not soft-deleted) assets with the given ids; unknown ids are omitted.
   * Pass `tx` to read inside a transaction.
   */
  async findByIds(ids: string[], tx?: EntityManager): Promise<Asset[]> {
    if (ids.length === 0) return [];
    return (tx ?? this.repository.manager).find(Asset, {
      where: { id: In(ids) },
    });
  }

  /**
   * Soft-deletes (sets `deletedAt`) the given assets in one statement.
   * Pass `tx` to run inside the caller's transaction.
   */
  async softDeleteMany(ids: string[], tx?: EntityManager): Promise<void> {
    if (ids.length === 0) return;
    await (tx ?? this.repository.manager).softDelete(Asset, { id: In(ids) });
  }
}
