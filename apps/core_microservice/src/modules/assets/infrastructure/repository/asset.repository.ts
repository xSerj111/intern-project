import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  EntityByIdNotFoundError,
  TypeormRepositoryBase,
  type QueryParams,
  type WhereCondition,
} from '@repo/shared';
import { Asset } from '../../domain/entities/asset.entity';

@Injectable()
export class AssetRepository extends TypeormRepositoryBase<Asset, any> {
  public static readonly entity = Asset;
  protected relations: string[] = [];

  constructor(@InjectRepository(Asset) repository: Repository<Asset>) {
    super(repository);
  }

  /** Every inherited read sees only `READY` rows; uploads use `UploadRepository`. */
  protected prepareQuery(
    params: QueryParams<any>,
  ): WhereCondition<Asset> | undefined {
    const where = super.prepareQuery(params);
    if (!where) return undefined;
    return Array.isArray(where)
      ? where.map((w) => ({ ...w, status: 'READY' as const }))
      : { ...where, status: 'READY' as const };
  }

  public async findOneByIdOrThrow(
    id: string,
    relations?: string[],
  ): Promise<Asset> {
    const found = await this.repository.findOne({
      relations: this.resolveRelations(relations),
      where: { id, status: 'READY' },
    });
    if (!found) throw new EntityByIdNotFoundError(this.tableName, id);
    return found;
  }

  /**
   * Live (not soft-deleted) `READY` assets with the given ids; unknown and
   * unconfirmed ids are omitted. Pass `tx` to read inside a transaction.
   */
  async findByIds(ids: string[], tx?: EntityManager): Promise<Asset[]> {
    if (ids.length === 0) return [];
    return (tx ?? this.repository.manager).find(Asset, {
      where: { id: In(ids), status: 'READY' },
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
