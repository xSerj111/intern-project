import type { ProcessedEvent } from '../entities/processed-event.entity';
import type { TransactionContext } from './notification-repository.port';

export interface IProcessedEventRepository {
  /** `INSERT ... ON CONFLICT DO NOTHING` inside `tx`; `false` when the event id already exists. */
  tryInsert(event: ProcessedEvent, tx: TransactionContext): Promise<boolean>;
  findById(eventId: string): Promise<ProcessedEvent | null>;
  markFollowUpDone(eventId: string): Promise<void>;
  /** Deletes rows processed before `cutoff`; returns the count. */
  deleteProcessedBefore(cutoff: Date): Promise<number>;
}

export const PROCESSED_EVENT_REPOSITORY = Symbol.for(
  'IProcessedEventRepository',
);
