import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Logger } from '../logger/logger.port';
import {
  isExcludedPath,
  routeLabel,
  trackRoute,
  type RoutedRequest,
} from './http-route';

/** HTTP header carrying the request id (accepted on input, echoed on output). */
export const REQUEST_ID_HEADER = 'x-request-id';
/** AMQP message header carrying the originating request id. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Client-supplied ids are kept only when short and free of odd characters. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Runs `fn` (and every async continuation it starts) with `requestId` as the current id. */
export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** The id of the request (or AMQP message) being handled, if any. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Returns the incoming id when it is valid, otherwise a fresh UUID. */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
    ? incoming
    : randomUUID();
}

/**
 * Express-compatible middleware: accepts a valid `X-Request-Id` or generates
 * one, echoes it on the response and runs the rest of the chain inside the
 * request context. Register it before every other middleware.
 */
export function requestIdMiddleware() {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void => {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestContext(requestId, next);
  };
}

/**
 * Express-compatible middleware writing one log line per response on
 * `finish`: method, route template, status and duration. The route is read on
 * `finish` because routing has not happened yet when the middleware runs.
 * Never logs query strings, bodies or headers. Skips health and metrics.
 */
export function accessLogMiddleware(logger: Pick<Logger, 'info' | 'error'>) {
  return (req: RoutedRequest, res: ServerResponse, next: () => void): void => {
    if (isExcludedPath(req)) {
      next();
      return;
    }
    trackRoute(req, res);

    const correlationId = currentRequestId();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs =
        Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100;
      const method = req.method ?? 'UNKNOWN';
      const route = routeLabel(req);
      const status = res.statusCode;
      const data = {
        context: 'AccessLog',
        ...(correlationId ? { correlationId } : {}),
        props: { method, route, status, durationMs },
      };
      const message = `${method} ${route} ${status}`;
      if (status >= 500) logger.error(message, data);
      else logger.info(message, data);
    });
    next();
  };
}
