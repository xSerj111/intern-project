import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, type EntityManager, type Repository } from 'typeorm';
import { Notification } from '../../domain/entities/notification.entity';
import type {
  INotificationRepository,
  NotificationPage,
  TransactionContext,
} from '../../domain/interfaces/notification-repository.port';

@Injectable()
export class NotificationRepository implements INotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  /**
   * `ON CONFLICT DO NOTHING` without a conflict target covers both
   * `UQ_notifications_sourceEventId` and the like partial unique index, and
   * (unlike catching the error) leaves the transaction usable.
   */
  async insert(
    notification: Notification,
    tx: TransactionContext,
  ): Promise<boolean> {
    const result = await (tx as EntityManager)
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values(notification)
      .orIgnore()
      .returning('id')
      .execute();
    return (result.raw as unknown[]).length > 0;
  }

  findBySourceEventId(eventId: string): Promise<Notification | null> {
    return this.repository.findOne({ where: { sourceEventId: eventId } });
  }

  async page(
    recipientId: string,
    options: { before?: Date; limit: number },
  ): Promise<NotificationPage> {
    const rows = await this.repository.find({
      where: {
        recipientId,
        ...(options.before ? { occurredAt: LessThan(options.before) } : {}),
      },
      // `id` keeps the order stable for equal timestamps.
      order: { occurredAt: 'DESC', id: 'DESC' },
      take: options.limit + 1,
    });
    return {
      items: rows.slice(0, options.limit),
      hasMore: rows.length > options.limit,
    };
  }

  unseenCount(recipientId: string): Promise<number> {
    return this.repository.count({ where: { recipientId, seenAt: IsNull() } });
  }

  async markSeenUpTo(recipientId: string, upTo: Date): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Notification)
      .set({ seenAt: () => 'now()' })
      .where('"recipientId" = :recipientId', { recipientId })
      .andWhere('"seenAt" IS NULL')
      .andWhere('"occurredAt" <= :upTo', { upTo })
      .execute();
    return result.affected ?? 0;
  }

  runInTransaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.repository.manager.transaction((manager) => work(manager));
  }
}
