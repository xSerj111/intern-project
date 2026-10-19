import { Logger } from '@nestjs/common';
import type { EmailJob } from '@repo/shared';
import type {
  DeliveryContext,
  IConsumerRegistry,
} from '../../../common/messaging/consumer.types';
import { EmailDelivery } from '../domain/entities/email-delivery.entity';
import { EmailWorker } from './email.worker';

const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111';
const JOB: EmailJob = {
  jobId: `0b9a1c3e-5d1f-4c8e-9a7b-1f2e3d4c5b6a:${RECIPIENT_ID}`,
  recipientId: RECIPIENT_ID,
  kind: 'NEW_MESSAGE',
  actor: {
    userId: '33333333-3333-4333-8333-333333333333',
    username: 'anna',
    displayName: 'Anna',
    avatarUrl: null,
  },
  link: 'http://localhost:3000/messages/22222222-2222-4222-8222-222222222222',
  summary: 'Anna sent you a message',
  excerpt: 'Hi there',
};

function ctx(attempt: number): DeliveryContext {
  return {
    attempt,
    maxAttempts: 3,
    isFinalAttempt: attempt >= 3,
    queue: 'notifications.email',
  };
}

function setup(existing: EmailDelivery | null = null) {
  let stored = existing;
  const deliveries = {
    findByJobId: jest.fn(() => Promise.resolve(stored)),
    save: jest.fn((d: EmailDelivery) => {
      stored = d;
      return Promise.resolve(d);
    }),
  };
  const directory = {
    getEmail: jest.fn().mockResolvedValue('b@example.com'),
  };
  const mailer = { send: jest.fn().mockResolvedValue(undefined) };
  const registerEmailHandler = jest.fn();
  const registry: IConsumerRegistry = {
    registerEventHandler: jest.fn(),
    registerEmailHandler,
  };
  const worker = new EmailWorker(registry, deliveries, directory, mailer);
  return {
    worker,
    registerEmailHandler,
    deliveries,
    directory,
    mailer,
    stored: () => stored,
  };
}

describe('EmailWorker', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers as the email handler', () => {
    const { worker, registerEmailHandler } = setup();
    worker.onModuleInit();
    expect(registerEmailHandler).toHaveBeenCalledWith(worker);
  });

  it('sends the rendered email and marks the delivery SENT with sentAt', async () => {
    const { worker, mailer, stored } = setup();

    await worker.handle(JOB, ctx(1));

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'b@example.com',
        subject: 'Anna sent you a message',
      }),
    );
    const row = stored()!;
    expect(row.status).toBe('SENT');
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.attempts).toBe(1);
  });

  it('skips a job whose delivery is already SENT', async () => {
    const sent = EmailDelivery.pending(JOB.jobId, RECIPIENT_ID, 'NEW_MESSAGE');
    sent.markSent(new Date());
    const { worker, mailer, directory, deliveries } = setup(sent);

    await worker.handle(JOB, ctx(1));

    expect(directory.getEmail).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(deliveries.save).not.toHaveBeenCalled();
  });

  it('records a send failure and throws so the job is retried', async () => {
    const { worker, mailer, stored } = setup();
    mailer.send.mockRejectedValue(new Error('SMTP down'));

    await expect(worker.handle(JOB, ctx(1))).rejects.toThrow('SMTP down');

    const row = stored()!;
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('SMTP down');
  });

  it('retries when the recipient directory is unavailable', async () => {
    const { worker, directory, mailer, stored } = setup();
    directory.getEmail.mockRejectedValue(new Error('auth timeout'));

    await expect(worker.handle(JOB, ctx(1))).rejects.toThrow('auth timeout');

    expect(mailer.send).not.toHaveBeenCalled();
    expect(stored()!.attempts).toBe(1);
  });

  it('marks FAILED on the 3rd failure, logs an error with jobId and reason, and acks', async () => {
    const { worker, mailer, stored } = setup();
    mailer.send.mockRejectedValue(new Error('SMTP down'));

    await expect(worker.handle(JOB, ctx(1))).rejects.toThrow();
    await expect(worker.handle(JOB, ctx(2))).rejects.toThrow();
    await expect(worker.handle(JOB, ctx(3))).resolves.toBeUndefined();

    const row = stored()!;
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(JOB.jobId));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP down'));
  });

  it('marks FAILED on the final queue attempt even if earlier failures were not recorded', async () => {
    const { worker, mailer, stored } = setup();
    mailer.send.mockRejectedValue(new Error('SMTP down'));

    await expect(worker.handle(JOB, ctx(3))).resolves.toBeUndefined();

    expect(stored()!.status).toBe('FAILED');
    expect(stored()!.attempts).toBe(3);
  });

  it('marks FAILED without retry when the recipient has no email', async () => {
    const { worker, directory, mailer, stored } = setup();
    directory.getEmail.mockResolvedValue(null);

    await expect(worker.handle(JOB, ctx(1))).resolves.toBeUndefined();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(stored()!.status).toBe('FAILED');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(JOB.jobId));
  });

  it('acks a job whose delivery is already FAILED without sending', async () => {
    const failed = EmailDelivery.pending(
      JOB.jobId,
      RECIPIENT_ID,
      'NEW_MESSAGE',
    );
    failed.markFailed(new Error('x'));
    const { worker, mailer } = setup(failed);

    await expect(worker.handle(JOB, ctx(1))).resolves.toBeUndefined();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('onExhausted marks a still-pending delivery FAILED', async () => {
    const pending = EmailDelivery.pending(
      JOB.jobId,
      RECIPIENT_ID,
      'NEW_MESSAGE',
    );
    const { worker, stored } = setup(pending);

    await worker.onExhausted(JOB, new Error('db down'));

    expect(stored()!.status).toBe('FAILED');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
