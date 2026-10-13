import type { AccessTokenVerifier, VerifyResult } from '@repo/shared';
import { DomainError } from '@repo/shared';
import type { ArgumentsHost } from '@nestjs/common';
import { SessionRevocationListener } from '../../../../common/redis/session-revocation.listener';
import { ChatsGateway } from './chats.gateway';
import {
  createSocketAuthMiddleware,
  type RealtimeSocket,
} from './socket-auth.middleware';
import { WsDomainExceptionFilter } from './ws-domain-exception.filter';

const USER = '11111111-1111-4111-8111-111111111111';
const future = () => Math.floor(Date.now() / 1000) + 600;

const ok = (
  payload: Partial<{ sub: string; sid: string; jti: string; exp: number }> = {},
): VerifyResult => ({
  ok: true,
  payload: {
    sub: USER,
    email: 'a@b.c',
    jti: 'jti-2',
    sid: 'sid-1',
    exp: future(),
    ...payload,
  },
});

function fakeSocket(
  data: Partial<RealtimeSocket['data']> = {},
  auth: Record<string, unknown> = {},
) {
  return {
    id: 'sock-1',
    handshake: { auth, query: { token: 'from-query' } },
    data: {
      userId: USER,
      sid: 'sid-1',
      jti: 'jti-1',
      exp: future(),
      viewingChatId: null,
      ...data,
    },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as RealtimeSocket & { emit: jest.Mock; disconnect: jest.Mock };
}

describe('createSocketAuthMiddleware', () => {
  const run = (verify: jest.Mock, socket: RealtimeSocket) =>
    new Promise<Error | undefined>((resolve) =>
      createSocketAuthMiddleware({ verify } as unknown as AccessTokenVerifier)(
        socket,
        resolve,
      ),
    );

  it('sets socket.data from the handshake auth token', async () => {
    const verify = jest.fn().mockResolvedValue(ok({ jti: 'jti-1' }));
    const socket = fakeSocket({}, { token: 'tok' });
    socket.data = {} as RealtimeSocket['data'];

    await expect(run(verify, socket)).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledWith('tok');
    expect(socket.data).toMatchObject({
      userId: USER,
      sid: 'sid-1',
      jti: 'jti-1',
      viewingChatId: null,
    });
  });

  it('ignores the query string and rejects as unauthorized', async () => {
    const verify = jest
      .fn()
      .mockResolvedValue({ ok: false, reason: 'missing' });
    const err = await run(verify, fakeSocket());
    expect(verify).toHaveBeenCalledWith(undefined);
    expect(err?.message).toBe('unauthorized');
  });

  it('rejects as unavailable when Redis is down', async () => {
    const verify = jest
      .fn()
      .mockResolvedValue({ ok: false, reason: 'unavailable' });
    const err = await run(verify, fakeSocket({}, { token: 't' }));
    expect(err?.message).toBe('unavailable');
  });
});

describe('ChatsGateway auth:renew', () => {
  let verify: jest.Mock;
  let redis: { exists: jest.Mock };
  let gateway: ChatsGateway;

  beforeEach(() => {
    jest.useFakeTimers();
    verify = jest.fn();
    redis = { exists: jest.fn().mockResolvedValue(0) };
    gateway = new ChatsGateway(
      { verify } as unknown as AccessTokenVerifier,
      redis as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('swaps jti/sid/exp and acks expiresAt', async () => {
    const exp = future();
    verify.mockResolvedValue(ok({ exp }));
    const socket = fakeSocket();
    const ack = jest.fn();

    await gateway.handleAuthRenew(socket, { token: 'new' }, ack);

    expect(socket.data.jti).toBe('jti-2');
    expect(socket.data.exp).toBe(exp);
    expect(ack).toHaveBeenCalledWith({
      ok: true,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
    gateway.handleDisconnect(socket);
  });

  it('disconnects when the new token belongs to another session', async () => {
    verify.mockResolvedValue(ok({ sid: 'other' }));
    const socket = fakeSocket();
    const ack = jest.fn();

    await gateway.handleAuthRenew(socket, { token: 'new' }, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('re-checks the blacklist first and closes a revoked socket', async () => {
    redis.exists.mockResolvedValue(1);
    const socket = fakeSocket();

    await gateway.handleAuthRenew(socket, { token: 'new' }, jest.fn());

    expect(verify).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('session:expired', {
      reason: 'revoked',
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('expires the socket at exp and clears the timer on disconnect', async () => {
    const socket = fakeSocket({ exp: Math.floor(Date.now() / 1000) + 5 });
    await gateway.handleConnection(socket);

    jest.advanceTimersByTime(6000);
    expect(socket.emit).toHaveBeenCalledWith('session:expired', {
      reason: 'expired',
    });

    const other = fakeSocket({ exp: Math.floor(Date.now() / 1000) + 5 });
    await gateway.handleConnection(other);
    gateway.handleDisconnect(other);
    jest.advanceTimersByTime(6000);
    expect(other.emit).not.toHaveBeenCalled();
  });
});

describe('WsDomainExceptionFilter', () => {
  class SampleError extends DomainError {
    constructor() {
      super('nope');
    }
  }

  it('acks a DomainError as { ok: false, error }', () => {
    const ack = jest.fn();
    const host = {
      getArgs: () => [{}, {}, ack, 'chat:view'],
    } as unknown as ArgumentsHost;

    new WsDomainExceptionFilter().catch(new SampleError(), host);

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: { code: 'SampleError', message: 'nope' },
    });
  });
});

describe('SessionRevocationListener', () => {
  it('disconnects only the sockets of the revoked session', async () => {
    const mk = (sid: string | null, jti: string) => ({
      data: { sid, jti },
      emit: jest.fn(),
      disconnect: jest.fn(),
    });
    const hit = mk('sid-1', 'a');
    const miss = mk('sid-2', 'b');
    const byJti = mk(null, 'c');
    const fetchSockets = jest.fn().mockResolvedValue([hit, miss, byJti]);
    const gateway = {
      server: { in: jest.fn(() => ({ fetchSockets })) },
    } as unknown as ChatsGateway;
    const listener = new SessionRevocationListener({} as never, gateway);

    await listener.handleMessage(
      JSON.stringify({
        userId: USER,
        sid: 'sid-1',
        jti: 'a',
        revokedAt: new Date().toISOString(),
      }),
    );
    expect(hit.emit).toHaveBeenCalledWith('session:expired', {
      reason: 'revoked',
    });
    expect(hit.disconnect).toHaveBeenCalledWith(true);
    expect(miss.disconnect).not.toHaveBeenCalled();
    expect(byJti.disconnect).not.toHaveBeenCalled();

    await listener.handleMessage(
      JSON.stringify({
        userId: USER,
        sid: null,
        jti: 'c',
        revokedAt: new Date().toISOString(),
      }),
    );
    expect(byJti.disconnect).toHaveBeenCalledWith(true);
  });

  it('ignores invalid payloads', async () => {
    const gateway = { server: { in: jest.fn() } } as unknown as ChatsGateway;
    const listener = new SessionRevocationListener({} as never, gateway);
    await listener.handleMessage('{"userId":"not-a-uuid"}');
    await listener.handleMessage('garbage');
    expect(gateway.server.in).not.toHaveBeenCalled();
  });
});
