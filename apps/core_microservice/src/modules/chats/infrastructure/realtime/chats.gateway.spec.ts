import type { AccessTokenVerifier, VerifyResult } from '@repo/shared';
import { DomainError } from '@repo/shared';
import { Logger, type ArgumentsHost } from '@nestjs/common';
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

type FakeSocket = RealtimeSocket & {
  mocks: { emit: jest.Mock; disconnect: jest.Mock };
};

function fakeSocket(
  data: Partial<RealtimeSocket['data']> = {},
  auth: Record<string, unknown> = {},
) {
  const emit = jest.fn();
  const disconnect = jest.fn();
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
    rooms: new Set<string>(),
    emit,
    disconnect,
    mocks: { emit, disconnect },
  } as unknown as FakeSocket;
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
      { findActiveChatIdsForUser: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
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
    expect(socket.mocks.disconnect).toHaveBeenCalledWith(true);
  });

  it('re-checks the blacklist first and closes a revoked socket', async () => {
    redis.exists.mockResolvedValue(1);
    const socket = fakeSocket();

    await gateway.handleAuthRenew(socket, { token: 'new' }, jest.fn());

    expect(verify).not.toHaveBeenCalled();
    expect(socket.mocks.emit).toHaveBeenCalledWith('session:expired', {
      reason: 'revoked',
    });
    expect(socket.mocks.disconnect).toHaveBeenCalledWith(true);
  });

  it('expires the socket at exp and clears the timer on disconnect', async () => {
    const socket = fakeSocket({ exp: Math.floor(Date.now() / 1000) + 5 });
    await gateway.handleConnection(socket);

    jest.advanceTimersByTime(6000);
    expect(socket.mocks.emit).toHaveBeenCalledWith('session:expired', {
      reason: 'expired',
    });

    const other = fakeSocket({ exp: Math.floor(Date.now() / 1000) + 5 });
    await gateway.handleConnection(other);
    gateway.handleDisconnect(other);
    jest.advanceTimersByTime(6000);
    expect(other.mocks.emit).not.toHaveBeenCalled();
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
    const serverIn = jest.fn();
    const gateway = { server: { in: serverIn } } as unknown as ChatsGateway;
    const listener = new SessionRevocationListener({} as never, gateway);
    await listener.handleMessage('{"userId":"not-a-uuid"}');
    await listener.handleMessage('garbage');
    expect(serverIn).not.toHaveBeenCalled();
  });
});

describe('ChatsGateway handleConnection', () => {
  const build = (find: jest.Mock) =>
    new ChatsGateway(
      {} as never,
      {} as never,
      {
        findActiveChatIdsForUser: find,
      } as never,
      {} as never,
    );
  const socket = () => {
    const join = jest.fn().mockResolvedValue(undefined);
    return {
      join,
      s: {
        id: 's1',
        data: { userId: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 },
        join,
      } as never as Parameters<ChatsGateway['handleConnection']>[0],
    };
  };

  it('joins the user room and every active chat room', async () => {
    const gateway = build(jest.fn().mockResolvedValue(['c1', 'c2']));
    const { s, join } = socket();
    await gateway.handleConnection(s);
    expect(join).toHaveBeenCalledWith('user:u1');
    expect(join).toHaveBeenCalledWith(['chat:c1', 'chat:c2']);
    gateway.handleDisconnect(s);
  });

  it('stays connected on the user room when the lookup fails', async () => {
    const gateway = build(jest.fn().mockRejectedValue(new Error('db down')));
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { s, join } = socket();
    await expect(gateway.handleConnection(s)).resolves.toBeUndefined();
    expect(join).toHaveBeenCalledTimes(1);
    gateway.handleDisconnect(s);
  });
});

describe('ChatsGateway typing and chat:view', () => {
  const CHAT = '22222222-2222-4222-8222-222222222222';
  const typer = { userId: USER, displayName: 'Anna' } as never;
  let redis: { exists: jest.Mock };
  let getUsers: jest.Mock;
  let emit: jest.Mock;
  let except: jest.Mock;
  let to: jest.Mock;
  let gateway: ChatsGateway;

  const member = (data: Partial<RealtimeSocket['data']> = {}) => {
    const socket = fakeSocket(data);
    socket.rooms.add(`chat:${CHAT}`);
    return socket;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    redis = { exists: jest.fn().mockResolvedValue(0) };
    getUsers = jest.fn().mockResolvedValue(new Map([[USER, typer]]));
    emit = jest.fn();
    except = jest.fn(() => ({ emit }));
    to = jest.fn(() => ({ except }));
    gateway = new ChatsGateway(
      {} as never,
      redis as never,
      {} as never,
      { getUsers } as never,
    );
    gateway.server = { to } as never;
  });

  afterEach(() => jest.useRealTimers());

  it('ignores typing:start from a socket not in the chat room', async () => {
    await gateway.handleTypingStart(fakeSocket(), { chatId: CHAT });
    expect(to).not.toHaveBeenCalled();
  });

  it('relays a member typing:start to the room except the typer', async () => {
    await gateway.handleTypingStart(member(), { chatId: CHAT });

    expect(to).toHaveBeenCalledWith(`chat:${CHAT}`);
    expect(except).toHaveBeenCalledWith(`user:${USER}`);
    expect(emit).toHaveBeenCalledWith('typing', {
      chatId: CHAT,
      user: typer,
      isTyping: true,
    });
  });

  it('throttles a second typing:start within 2 s and resolves the user once', async () => {
    const socket = member();
    await gateway.handleTypingStart(socket, { chatId: CHAT });
    jest.advanceTimersByTime(1500);
    await gateway.handleTypingStart(socket, { chatId: CHAT });
    expect(emit).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(600);
    await gateway.handleTypingStart(socket, { chatId: CHAT });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(getUsers).toHaveBeenCalledTimes(1);
  });

  it('relays typing:stop with isTyping false', async () => {
    await gateway.handleTypingStop(member(), { chatId: CHAT });
    expect(emit).toHaveBeenCalledWith('typing', {
      chatId: CHAT,
      user: typer,
      isTyping: false,
    });
  });

  it('rejects a blacklisted jti before relaying', async () => {
    redis.exists.mockResolvedValue(1);
    const socket = member();

    await gateway.handleTypingStart(socket, { chatId: CHAT });
    await gateway.handleTypingStop(socket, { chatId: CHAT });

    const { emit: socketEmit, disconnect } = socket as unknown as Record<
      'emit' | 'disconnect',
      jest.Mock
    >;
    expect(to).not.toHaveBeenCalled();
    expect(socketEmit).toHaveBeenCalledWith('session:expired', {
      reason: 'revoked',
    });
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('emitTypingStopped broadcasts isTyping false except the user, without a directory lookup', () => {
    gateway.emitTypingStopped(CHAT, typer);
    expect(getUsers).not.toHaveBeenCalled();
    expect(except).toHaveBeenCalledWith(`user:${USER}`);
    expect(emit).toHaveBeenCalledWith('typing', {
      chatId: CHAT,
      user: typer,
      isTyping: false,
    });
  });

  it('chat:view sets viewingChatId only for a joined room and clears on null', async () => {
    const socket = member();
    const ack = jest.fn();

    await gateway.handleChatView(socket, { chatId: CHAT }, ack);
    expect(socket.data.viewingChatId).toBe(CHAT);
    expect(ack).toHaveBeenLastCalledWith({ ok: true });

    await gateway.handleChatView(socket, { chatId: 'other' }, ack);
    expect(socket.data.viewingChatId).toBeNull();

    await gateway.handleChatView(socket, { chatId: CHAT }, ack);
    await gateway.handleChatView(socket, { chatId: null }, ack);
    expect(socket.data.viewingChatId).toBeNull();
  });

  it('chat:view re-checks the blacklist first', async () => {
    redis.exists.mockResolvedValue(1);
    const socket = member();
    const ack = jest.fn();
    await gateway.handleChatView(socket, { chatId: CHAT }, ack);
    expect(socket.data.viewingChatId).toBeNull();
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
});
