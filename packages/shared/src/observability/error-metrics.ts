import { Counter, Registry } from 'prom-client';
import { setProcessErrorRecorder } from '../logger/winston.logger';

const ERRORS_NAME = 'errors_total';

/** Where an error was caught. */
export type ErrorSource = 'http' | 'amqp' | 'process';

export type ErrorsCounter = Counter<'source' | 'type'>;

/** The part of the counter callers need (kept minimal so tests can stub it). */
export type ErrorsCounterLike = Pick<ErrorsCounter, 'inc'>;

const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

/**
 * Bounded `type` label: the error's class name, `Error` when it has no usable
 * one, `NonError` for thrown non-Error values. Never the message.
 */
export function errorType(error: unknown): string {
  if (!(error instanceof Error)) return 'NonError';
  const name = (error.constructor as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && CLASS_NAME.test(name) ? name : 'Error';
}

/** Increments `errors_total{source, type}`; a no-op without a counter. */
export function recordError(
  counter: ErrorsCounterLike | undefined,
  source: ErrorSource,
  error: unknown,
): void {
  counter?.inc({ source, type: errorType(error) });
}

/**
 * Get-or-create `errors_total{source,type}` on `registry`, so registering it
 * twice is safe. The counter also becomes the sink for the process-level
 * `uncaughtException` / `unhandledRejection` handlers (`source="process"`).
 */
export function createErrorsCounter(registry: Registry): ErrorsCounter {
  const existing = registry.getSingleMetric(ERRORS_NAME) as
    ErrorsCounter | undefined;
  const counter =
    existing ??
    new Counter({
      name: ERRORS_NAME,
      help: 'Errors by source (http, amqp, process) and error class',
      labelNames: ['source', 'type'],
      registers: [registry],
    });
  setProcessErrorRecorder((error) => recordError(counter, 'process', error));
  return counter;
}
