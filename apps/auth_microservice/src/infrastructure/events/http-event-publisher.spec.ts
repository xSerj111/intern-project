process.env.CORE_SERVICE_URL = 'http://core.test:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'a'.repeat(40);

import type { UserCreatedEvent, WinstonLogger } from '@repo/shared';
import { HttpEventPublisher } from './http-event-publisher';

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
    publisher = new HttpEventPublisher(logger as unknown as WinstonLogger);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs the event as JSON to the core internal endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });

    publisher.publishUserCreatedEvent(payload);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://core.test:3001/internal/events/user-created',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
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
  });

  it('logs an error and does not throw when the network call fails', async () => {
    const err = new Error('ECONNREFUSED');
    fetchMock.mockRejectedValue(err);

    expect(() => publisher.publishUserCreatedEvent(payload)).not.toThrow();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      'Network error while publishing event to Core',
      { error: err },
    );
  });
});
