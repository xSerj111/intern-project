import { EventEmitter } from 'node:events';
import { RedisKeys } from '@repo/shared';
import { userRoom } from '../../modules/chats/infrastructure/realtime/chats.gateway';
import { SessionRevocationListener } from './session-revocation.listener';

const USER_ID = '8f14e45f-ceea-467a-9b5e-3e5f3c6d1a11';
const REVOKED_AT = '2026-01-01T00:00:00.000Z';

const fakeSocket = (data: Record<string, unknown>) => ({
  data,
  emit: jest.fn(),
  disconnect: jest.fn(),
});

describe('SessionRevocationListener', () => {
  let subscriber: EventEmitter & {
    subscribe: jest.Mock;
    unsubscribe: jest.Mock;
    quit: jest.Mock;
    disconnect: jest.Mock;
  };
  let redis: { duplicate: jest.Mock };
  let fetchSockets: jest.Mock;
  let inRoom: jest.Mock;
  let listener: SessionRevocationListener;
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  const message = (payload: object) => JSON.stringify(payload);
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    subscriber = Object.assign(new EventEmitter(), {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    });
    redis = { duplicate: jest.fn(() => subscriber) };
    fetchSockets = jest.fn().mockResolvedValue([]);
    inRoom = jest.fn(() => ({ fetchSockets }));
    listener = new SessionRevocationListener(
      redis as never,
      {
        server: { in: inRoom },
      } as never,
    );
    // Logger is a per-instance Nest Logger; silence and observe it.
    const logger = (
      listener as unknown as { logger: Record<string, jest.Mock> }
    ).logger;
    logError = jest.spyOn(logger, 'error').mockImplementation();
    logWarn = jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'log').mockImplementation();
  });

  describe('onModuleInit', () => {
    it('subscribes on a duplicated connection to the revocation channel', async () => {
      await listener.onModuleInit();

      expect(redis.duplicate).toHaveBeenCalledTimes(1);
      expect(subscriber.subscribe).toHaveBeenCalledWith(
        RedisKeys.sessionRevokedChannel,
      );
    });

    it('does not fail startup when the subscribe call rejects', async () => {
      subscriber.subscribe.mockRejectedValue(new Error('no redis'));

      await expect(listener.onModuleInit()).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('no redis'),
      );
    });

    it('stringifies a non-Error subscribe failure', async () => {
      subscriber.subscribe.mockRejectedValue('nope');

      await listener.onModuleInit();

      expect(logError).toHaveBeenCalledWith(expect.stringContaining('nope'));
    });

    it('logs subscriber errors instead of letting them crash the process', async () => {
      await listener.onModuleInit();

      expect(() =>
        subscriber.emit('error', new Error('socket hang up')),
      ).not.toThrow();
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('socket hang up'),
      );
    });

    it('handles messages from the revocation channel only', async () => {
      await listener.onModuleInit();
      const sock = fakeSocket({ sid: 's-1' });
      fetchSockets.mockResolvedValue([sock]);

      subscriber.emit(
        'message',
        'some:other:channel',
        message({
          userId: USER_ID,
          sid: 's-1',
          jti: null,
          revokedAt: REVOKED_AT,
        }),
      );
      await flush();
      expect(sock.disconnect).not.toHaveBeenCalled();

      subscriber.emit(
        'message',
        RedisKeys.sessionRevokedChannel,
        message({
          userId: USER_ID,
          sid: 's-1',
          jti: null,
          revokedAt: REVOKED_AT,
        }),
      );
      await flush();
      expect(sock.disconnect).toHaveBeenCalledWith(true);
    });

    it('logs and swallows a handler failure', async () => {
      await listener.onModuleInit();
      fetchSockets.mockRejectedValue(new Error('adapter broke'));

      subscriber.emit(
        'message',
        RedisKeys.sessionRevokedChannel,
        message({
          userId: USER_ID,
          sid: 's-1',
          jti: null,
          revokedAt: REVOKED_AT,
        }),
      );
      await flush();

      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('adapter broke'),
      );
    });

    it('stringifies a non-Error handler failure', async () => {
      await listener.onModuleInit();
      fetchSockets.mockRejectedValue('bad');

      subscriber.emit(
        'message',
        RedisKeys.sessionRevokedChannel,
        message({
          userId: USER_ID,
          sid: 's-1',
          jti: null,
          revokedAt: REVOKED_AT,
        }),
      );
      await flush();

      expect(logError).toHaveBeenCalledWith(expect.stringContaining('bad'));
    });
  });

  describe('onModuleDestroy', () => {
    it('does nothing when never initialised', async () => {
      await expect(listener.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('unsubscribes and quits the subscriber connection', async () => {
      await listener.onModuleInit();

      await listener.onModuleDestroy();

      expect(subscriber.unsubscribe).toHaveBeenCalledWith(
        RedisKeys.sessionRevokedChannel,
      );
      expect(subscriber.quit).toHaveBeenCalledTimes(1);
      expect(subscriber.disconnect).not.toHaveBeenCalled();
    });

    it('force-disconnects when a graceful shutdown fails', async () => {
      await listener.onModuleInit();
      subscriber.unsubscribe.mockRejectedValue(new Error('closed'));

      await listener.onModuleDestroy();

      expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
    });

    it('is idempotent', async () => {
      await listener.onModuleInit();
      await listener.onModuleDestroy();
      await listener.onModuleDestroy();

      expect(subscriber.quit).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleMessage', () => {
    it.each([
      ['non-JSON', 'not json{'],
      ['a JSON primitive', '42'],
      ['JSON null', 'null'],
    ])('ignores a malformed message (%s)', async (_label, raw) => {
      await listener.handleMessage(raw);

      expect(logWarn).toHaveBeenCalledWith(
        'Ignoring malformed session revocation message',
      );
      expect(fetchSockets).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a non-UUID userId',
        { userId: 'x', sid: 's', jti: null, revokedAt: REVOKED_AT },
      ],
      ['a missing revokedAt', { userId: USER_ID, sid: 's', jti: null }],
      [
        'a non-string sid',
        { userId: USER_ID, sid: 5, jti: null, revokedAt: REVOKED_AT },
      ],
    ])('ignores an invalid event (%s)', async (_label, payload) => {
      await listener.handleMessage(message(payload));

      expect(logWarn).toHaveBeenCalledWith(
        'Ignoring invalid session revocation message',
      );
      expect(fetchSockets).not.toHaveBeenCalled();
    });

    it('does nothing when the event carries neither sid nor jti', async () => {
      await listener.handleMessage(
        message({
          userId: USER_ID,
          sid: null,
          jti: null,
          revokedAt: REVOKED_AT,
        }),
      );

      expect(inRoom).not.toHaveBeenCalled();
    });

    it('disconnects only the sockets of the revoked session (by sid)', async () => {
      const match = fakeSocket({ sid: 's-1', jti: 'j-1' });
      const other = fakeSocket({ sid: 's-2', jti: 'j-1' });
      fetchSockets.mockResolvedValue([match, other]);

      await listener.handleMessage(
        message({
          userId: USER_ID,
          sid: 's-1',
          jti: 'j-1',
          revokedAt: REVOKED_AT,
        }),
      );

      expect(inRoom).toHaveBeenCalledWith(userRoom(USER_ID));
      expect(match.emit).toHaveBeenCalledWith('session:expired', {
        reason: 'revoked',
      });
      expect(match.disconnect).toHaveBeenCalledWith(true);
      expect(other.emit).not.toHaveBeenCalled();
      expect(other.disconnect).not.toHaveBeenCalled();
    });

    it('matches by jti when the token has no session id', async () => {
      const match = fakeSocket({ jti: 'j-1' });
      const other = fakeSocket({ jti: 'j-2' });
      fetchSockets.mockResolvedValue([match, other]);

      await listener.handleMessage(
        message({ userId: USER_ID, jti: 'j-1', revokedAt: REVOKED_AT }),
      );

      expect(match.disconnect).toHaveBeenCalledWith(true);
      expect(other.disconnect).not.toHaveBeenCalled();
    });

    it('leaves the room alone when no socket matches', async () => {
      const other = fakeSocket({ sid: 's-9' });
      fetchSockets.mockResolvedValue([other]);

      await listener.handleMessage(
        message({
          userId: USER_ID,
          sid: 's-1',
          jti: null,
          revokedAt: REVOKED_AT,
        }),
      );

      expect(other.disconnect).not.toHaveBeenCalled();
    });
  });
});
