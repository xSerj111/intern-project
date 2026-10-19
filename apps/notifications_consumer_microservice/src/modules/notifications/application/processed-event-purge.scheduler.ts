import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ProcessedEvent } from '../domain/entities/processed-event.entity';
import {
  PROCESSED_EVENT_REPOSITORY,
  type IProcessedEventRepository,
} from '../domain/interfaces/processed-event-repository.port';

/** How often the purge runs; the first run is at startup. */
export const PROCESSED_EVENT_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Deletes `processed_events` markers older than the retention window
 * (`PROCESSED_EVENT_RETENTION_DAYS`). Runs once at startup, then on an
 * interval; a failed run is logged and retried at the next tick.
 */
@Injectable()
export class ProcessedEventPurgeScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ProcessedEventPurgeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PROCESSED_EVENT_REPOSITORY)
    private readonly processedEvents: IProcessedEventRepository,
  ) {}

  onModuleInit(): void {
    void this.purge();
    this.timer = setInterval(
      () => void this.purge(),
      PROCESSED_EVENT_PURGE_INTERVAL_MS,
    );
    // Never keep the process alive just for the purge.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One purge pass; never rejects, and skips if the previous one is running. */
  async purge(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const removed = await this.processedEvents.deleteProcessedBefore(
        ProcessedEvent.retentionCutoff(now),
      );
      if (removed > 0) {
        this.logger.log(`Purged ${removed} expired processed event markers`);
      }
    } catch (error) {
      this.logger.warn(
        `Processed event purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
