import { isISO8601, isUUID } from 'class-validator';
import type { NotificationCursor } from '../domain/interfaces/notification-repository.port';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Strict ISO 8601 that `Date` can also parse (ISO week dates, for one, cannot). */
function toDate(value: string): Date | null {
  if (!isISO8601(value, { strict: true })) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Opaque `(occurredAt, id)` keyset cursor: base64url of `[isoOccurredAt, id]`. */
export function encodeNotificationCursor(cursor: {
  occurredAt: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify([cursor.occurredAt.toISOString(), cursor.id]),
  ).toString('base64url');
}

/**
 * Decodes a `before` value: the opaque cursor, or (for clients that still
 * send the last item's `occurredAt`) a strict ISO timestamp without an id.
 * Returns `null` for anything else, so the DTO can reject it with 400.
 */
export function parseNotificationCursor(
  value: string,
): NotificationCursor | null {
  const legacy = toDate(value);
  if (legacy) return { occurredAt: legacy };
  if (!BASE64URL.test(value)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) return null;
  const [rawOccurredAt, id] = decoded as unknown[];
  if (typeof rawOccurredAt !== 'string' || typeof id !== 'string') return null;
  const occurredAt = toDate(rawOccurredAt);
  if (!occurredAt || !isUUID(id)) return null;
  return { occurredAt, id };
}
