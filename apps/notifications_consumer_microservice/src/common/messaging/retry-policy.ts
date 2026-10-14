/** Delivery number of a message (1 = first delivery). Absent/garbage = 1. */
export const ATTEMPTS_HEADER = 'x-attempts';
/** Last handler error, set on retried and dead-lettered copies. */
export const LAST_ERROR_HEADER = 'x-last-error';
/** Routing key of the first delivery (a retry round trip replaces it). */
export const ORIGINAL_ROUTING_KEY_HEADER = 'x-original-routing-key';

export type FailureDecision =
  | { action: 'retry'; nextAttempt: number }
  | { action: 'dead-letter' }
  | { action: 'drop' };

/** Reads `x-attempts`; anything that is not a positive integer counts as 1. */
export function readAttempt(
  headers: Record<string, unknown> | undefined,
): number {
  const raw = headers?.[ATTEMPTS_HEADER];
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : typeof raw === 'bigint'
          ? Number(raw)
          : NaN;
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/**
 * What to do with a delivery whose handling failed. A poison message (invalid
 * payload, no handler) never improves on retry, so it skips the retry loop.
 * Exhausted or poison messages go to the DLQ when the queue has one, else are
 * dropped (email jobs: the worker records FAILED first).
 */
export function decideOnFailure(params: {
  attempt: number;
  maxAttempts: number;
  poison: boolean;
  hasDeadLetterQueue: boolean;
}): FailureDecision {
  const { attempt, maxAttempts, poison, hasDeadLetterQueue } = params;
  if (!poison && attempt < maxAttempts) {
    return { action: 'retry', nextAttempt: attempt + 1 };
  }
  return hasDeadLetterQueue ? { action: 'dead-letter' } : { action: 'drop' };
}

/** Header-safe error text, bounded so a huge stack can't bloat the message. */
export function describeError(error: unknown, max = 500): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
