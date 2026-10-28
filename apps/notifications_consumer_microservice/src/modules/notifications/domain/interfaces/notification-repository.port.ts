import type { Notification } from '../entities/notification.entity';

/**
 * Opaque handle for an open database transaction. The adapter creates it in
 * `runInTransaction` (the TypeORM `EntityManager`); the domain and
 * application layers only pass it back to repository methods.
 */
export type TransactionContext = object;

/**
 * Keyset position of the last row of the previous page. `id` breaks ties
 * between rows with the same `occurredAt`; without it (legacy ISO cursor)
 * the page starts strictly before `occurredAt`.
 */
export interface NotificationCursor {
  occurredAt: Date;
  id?: string;
}

export interface NotificationPage {
  items: Notification[];
  hasMore: boolean;
}

export interface INotificationRepository {
  /**
   * Inserts the notification inside `tx`. Returns `false` (without throwing,
   * so the transaction stays usable) when `sourceEventId` or the like
   * partial-unique index already holds a matching row, i.e. a duplicate.
   */
  insert(notification: Notification, tx: TransactionContext): Promise<boolean>;
  findBySourceEventId(eventId: string): Promise<Notification | null>;
  /** Newest first by `(occurredAt, id)`; `before` is an exclusive keyset cursor. */
  page(
    recipientId: string,
    options: { before?: NotificationCursor; limit: number },
  ): Promise<NotificationPage>;
  unseenCount(recipientId: string): Promise<number>;
  /** Marks unseen rows with `occurredAt <= upTo` seen; returns the rows changed. */
  markSeenUpTo(recipientId: string, upTo: Date): Promise<number>;
  runInTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export const NOTIFICATION_REPOSITORY = Symbol.for('INotificationRepository');
