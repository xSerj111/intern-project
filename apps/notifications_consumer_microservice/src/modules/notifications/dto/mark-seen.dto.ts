import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/** `POST /notifications/seen` body (mirrors `IMarkSeenRequest`). */
export class MarkSeenDto {
  /** ISO `occurredAt`; defaults to now. */
  @ApiPropertyOptional({
    description: 'ISO 8601 occurredAt; defaults to now.',
    format: 'date-time',
    example: '2026-01-01T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  upTo?: string;
}
