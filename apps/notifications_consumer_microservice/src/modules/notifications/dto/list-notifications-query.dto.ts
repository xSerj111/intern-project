import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import { PAGE_SIZE_MAX } from '@repo/contracts';
import { parseNotificationCursor } from './notification-cursor';

export const NOTIFICATIONS_DEFAULT_LIMIT = 20;
export const NOTIFICATIONS_MAX_LIMIT = PAGE_SIZE_MAX;

/** `before` must decode with `parseNotificationCursor`; anything else is a 400. */
function IsNotificationCursor(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotificationCursor',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && parseNotificationCursor(value) !== null,
        defaultMessage: () =>
          'before must be a nextCursor value or an ISO 8601 timestamp',
      },
    },
    options,
  );
}

/** `GET /notifications` query (mirrors `IListNotificationsQuery`). */
export class ListNotificationsQueryDto {
  /**
   * Opaque `nextCursor` from the previous page; only older notifications are
   * returned. A bare ISO `occurredAt` is still accepted (no tie-breaker).
   */
  @IsOptional()
  @IsNotificationCursor()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_MAX_LIMIT)
  limit?: number;
}
