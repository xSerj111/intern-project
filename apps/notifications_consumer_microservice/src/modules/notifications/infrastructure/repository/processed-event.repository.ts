import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, type EntityManager, type Repository } from 'typeorm';
import { ProcessedEvent } from '../../domain/entities/processed-event.entity';
import type { TransactionContext } from '../../domain/interfaces/notification-repository.port';
import type { IProcessedEventRepository } from '../../domain/interfaces/processed-event-repository.port';

@Injectable()
export class ProcessedEventRepository implements IProcessedEventRepository {
  constructor(
    @InjectRepository(ProcessedEvent)
    private readonly repository: Repository<ProcessedEvent>,
  ) {}

  async tryInsert(
    event: ProcessedEvent,
    tx: TransactionContext,
  ): Promise<boolean> {
    const result = await (tx as EntityManager)
      .createQueryBuilder()
      .insert()
      .into(ProcessedEvent)
      .values(event)
      .orIgnore()
      .returning('"eventId"')
      .execute();
    return (result.raw as unknown[]).length > 0;
  }

  findById(eventId: string): Promise<ProcessedEvent | null> {
    return this.repository.findOne({ where: { eventId } });
  }

  async markFollowUpDone(eventId: string): Promise<void> {
    await this.repository.update({ eventId }, { followUpDone: true });
  }

  async deleteProcessedBefore(cutoff: Date): Promise<number> {
    const result = await this.repository.delete({
      processedAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}
