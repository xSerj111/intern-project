import { IsISO8601, IsOptional } from 'class-validator';

/** `POST /notifications/seen` body (mirrors `IMarkSeenRequest`). */
export class MarkSeenDto {
  /** ISO `occurredAt`; defaults to now. */
  @IsOptional()
  @IsISO8601({ strict: true })
  upTo?: string;
}
