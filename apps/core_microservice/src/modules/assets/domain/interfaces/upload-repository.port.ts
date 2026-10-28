import type { Asset } from '../entities/asset.entity';

export const UPLOAD_REPOSITORY = Symbol('IUploadRepository');

/** Persistence for the signed-upload lifecycle. Unlike asset reads, it sees `PENDING` rows. */
export interface IUploadRepository {
  /** Live (not soft-deleted) asset in any status, or null. */
  findById(id: string): Promise<Asset | null>;

  save(asset: Asset): Promise<Asset>;

  /**
   * Locks up to `limit` `PENDING` rows whose `expiresAt` is more than `graceSec`
   * in the past (`FOR UPDATE SKIP LOCKED`, so concurrent sweepers never claim
   * the same row) and returns them. The lock lasts only for the claiming
   * transaction; callers delete the objects and then call {@link hardDelete}.
   */
  claimSweepable(limit: number, graceSec: number): Promise<Asset[]>;

  /** Removes the rows permanently. */
  hardDelete(ids: string[]): Promise<void>;
}
