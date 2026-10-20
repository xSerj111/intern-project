import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PAGE_SIZE_MAX } from '@repo/contracts';

export const NOTIFICATIONS_DEFAULT_LIMIT = 20;
export const NOTIFICATIONS_MAX_LIMIT = PAGE_SIZE_MAX;

/** `GET /notifications` query (mirrors `IListNotificationsQuery`). */
export class ListNotificationsQueryDto {
  /** ISO `occurredAt` cursor; only older notifications are returned. */
  @IsOptional()
  @IsISO8601({ strict: true })
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_MAX_LIMIT)
  limit?: number;
}
