process.env.CORE_SERVICE_URL = 'http://core.test:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'a'.repeat(40);

import {
  INTERNAL_TOKEN_HEADER,
  REQUEST_ID_HEADER,
  runWithRequestContext,
} from '@repo/shared';
import type { UserCreatedEvent, WinstonLogger } from '@repo/shared';
import { HttpEventPublisher } from './http-event-publisher';

const TOKEN = 't'.repeat(40);

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('HttpEventPublisher', () => {
  const payload = { userId: 'u1', email: 'a@b.c' } as unknown as UserCreatedEvent;
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let logger: { warn: jest.Mock; error: jest.Mock };
  let publisher: HttpEventPublisher;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    logger = { warn: jest.fn(), error: jest.fn() };
    publisher = new HttpEventPublisher(logger as unknown as WinstonLogger, TOKEN);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const loggedText = () =>
    JSON.stringify(
      [logger.warn.mock.calls as unknown[], logger.error.mock.calls as unknown[]],
      (_k, v: unknown) =>
        v instanceof Error ? { message: v.message, stack: v.stack } : v,
    );

  it('POSTs the event as JSON to the core internal endpoint with the internal token', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });

    publisher.publishUserCreatedEvent(payload);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://core.test:3001/internal/events/user-created',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: TOKEN,
        },
        body: JSON.stringify(payload),
      },
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('forwards the current request id to core', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });

    runWithRequestContext('req-123', () => publisher.publishUserCreatedEvent(payload));
    await flush();

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers[REQUEST_ID_HEADER]).toBe('req-123');
    expect(init.headers[INTERNAL_TOKEN_HEADER]).toBe(TOKEN);
  });

  it('omits the request id header when there is no request context', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });

    publisher.publishUserCreatedEvent(payload);
    await flush();

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers).not.toHaveProperty(REQUEST_ID_HEADER);
  });

  it('returns synchronously without waiting for the response (fire-and-forget)', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));

    expect(publisher.publishUserCreatedEvent(payload)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when core answers with a non-2xx status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    publisher.publishUserCreatedEvent(payload);
    await flush();

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to publish event to Core. Status: 500',
    );
    expect(loggedText()).not.toContain(TOKEN);
  });

  it('logs an error and does not throw when the network call fails', async () => {
    const err = new Error('ECONNREFUSED');
    fetchMock.mockRejectedValue(err);

    expect(() => publisher.publishUserCreatedEvent(payload)).not.toThrow();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      'Network error while publishing event to Core: ECONNREFUSED',
    );
  });

  it('never logs the token on the failure paths', async () => {
    fetchMock.mockRejectedValue(new Error('request failed'));
    publisher.publishUserCreatedEvent(payload);
    await flush();
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    publisher.publishUserCreatedEvent(payload);
    await flush();

    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(loggedText()).not.toContain(TOKEN);
  });
});
