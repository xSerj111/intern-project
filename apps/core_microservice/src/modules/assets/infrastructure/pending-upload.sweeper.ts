import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { FileStoragePortKey } from '../domain/interfaces/file-storage.port';
import type { IFileStoragePort } from '../domain/interfaces/file-storage.port';
import { UPLOAD_REPOSITORY } from '../domain/interfaces/upload-repository.port';
import type { IUploadRepository } from '../domain/interfaces/upload-repository.port';

export const SWEEP_BATCH_SIZE = 500;

/**
 * Removes abandoned signed uploads: `PENDING` assets whose link expired more
 * than `uploads.sweepGraceSec` ago. Each object is deleted first (a missing
 * object is fine), then the rows whose object is gone are hard-deleted. A row
 * whose object delete fails is kept and retried on the next tick. Ticks never
 * overlap and never throw.
 */
@Injectable()
export class PendingUploadSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingUploadSweeper.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | null = null;
  private readonly intervalMs: number;
  private readonly graceSec: number;

  constructor(
    @Inject(UPLOAD_REPOSITORY) private readonly uploads: IUploadRepository,
    @Inject(FileStoragePortKey) private readonly storage: IFileStoragePort,
    config: AppConfigService,
  ) {
    this.intervalMs = config.uploads.sweepIntervalSec * 1000;
    this.graceSec = config.uploads.sweepGraceSec;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  /** Runs one sweep, or joins the one already running. Never rejects. */
  tick(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.sweep()
        .catch((err) => {
          this.logger.warn(`Upload sweep failed: ${errorMessage(err)}`);
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  private async sweep(): Promise<void> {
    const rows = await this.uploads.claimSweepable(
      SWEEP_BATCH_SIZE,
      this.graceSec,
    );
    if (rows.length === 0) return;

    const deletable: string[] = [];
    for (const row of rows) {
      if (row.bucket && row.storageKey) {
        try {
          await this.storage.deleteObject(row.bucket, row.storageKey);
        } catch (err) {
          this.logger.warn(
            `Could not delete object of pending upload ${row.id}: ${errorMessage(err)}`,
          );
          continue; // keep the row; the next tick retries it
        }
      }
      deletable.push(row.id);
    }

    if (deletable.length > 0) {
      await this.uploads.hardDelete(deletable);
      this.logger.log(`Swept ${deletable.length} expired pending uploads`);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
