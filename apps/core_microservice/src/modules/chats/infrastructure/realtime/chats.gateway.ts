import { Inject, Logger, UseFilters } from '@nestjs/common';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import Redis from 'ioredis';
import type { DefaultEventsMap, Namespace } from 'socket.io';
import {
  REALTIME_NAMESPACE,
  type ClientToServerEvents,
  type IChatUser,
  type IRealtimeAckError,
  type ServerToClientEvents,
} from '@repo/contracts';
import { AccessTokenVerifier, RedisKeys } from '@repo/shared';
import {
  CHAT_REPOSITORY,
  type IChatRepository,
} from '../../domain/interfaces/chat-repository.port';
import {
  USER_DIRECTORY_PORT,
  type IUserDirectoryPort,
} from '../../../profiles/domain/interfaces/user-directory.port';
import { ACCESS_TOKEN_VERIFIER } from '../../../../common/auth/access-token-verifier.provider';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import type {
  ChatRealtimeEvent,
  ChatRealtimePayload,
  IChatRealtimePort,
} from '../../domain/interfaces/chat-realtime.port';
import {
  createSocketAuthMiddleware,
  type RealtimeSocket,
  type RealtimeSocketData,
} from './socket-auth.middleware';
import { WsDomainExceptionFilter } from './ws-domain-exception.filter';

export type RealtimeNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  RealtimeSocketData
>;

/** Typing state kept on `socket.data`; optional so the handshake can omit it. */
declare module './socket-auth.middleware' {
  interface RealtimeSocketData {
    /** The typer's wire profile, resolved once per socket. */
    typingUser?: IChatUser;
    /** Last relayed `typing:start` per chat id (ms since epoch). */
    typingRelayedAt?: Map<string, number>;
  }
}

/** One `typing:start` relay per socket per chat in this window (FR-018). */
const TYPING_THROTTLE_MS = 2000;

type RenewAck = (
  res: { ok: true; expiresAt: string } | IRealtimeAckError,
) => void;

/** setTimeout overflows above 2^31-1 ms (~24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

export const userRoom = (userId: string): string => `user:${userId}`;
export const chatRoom = (chatId: string): string => `chat:${chatId}`;

/** Read lazily: decorator options are evaluated before config is loaded. */
const clientUrl = (): string =>
  process.env.CLIENT_URL || 'http://localhost:3000';

@UseFilters(WsDomainExceptionFilter)
@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  cors: {
    origin: (
      _origin: string | undefined,
      cb: (err: Error | null, origin?: string) => void,
    ) => cb(null, clientUrl()),
    credentials: true,
  },
})
export class ChatsGateway
  implements
    IChatRealtimePort,
    OnGatewayInit<RealtimeNamespace>,
    OnGatewayConnection<RealtimeSocket>,
    OnGatewayDisconnect<RealtimeSocket>
{
  /** With a namespace configured, Nest injects the `Namespace`, not the root `Server`. */
  @WebSocketServer()
  server!: RealtimeNamespace;

  private readonly logger = new Logger('ChatsGateway');
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CHAT_REPOSITORY) private readonly chats: IChatRepository,
    @Inject(USER_DIRECTORY_PORT)
    private readonly directory: IUserDirectoryPort,
  ) {}

  afterInit(server: RealtimeNamespace): void {
    server.use(createSocketAuthMiddleware(this.verifier));
    this.logger.log(`Realtime gateway listening on ${REALTIME_NAMESPACE}`);
  }

  async handleConnection(socket: RealtimeSocket): Promise<void> {
    const { userId } = socket.data;
    await socket.join(userRoom(userId));
    try {
      const chatIds = await this.chats.findActiveChatIdsForUser(userId);
      await socket.join(chatIds.map(chatRoom));
    } catch (err) {
      // Keep the socket on its user room; live chat events resume on reconnect.
      this.logger.error(
        `Failed to join chat rooms for user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    this.scheduleExpiry(socket);
  }

  handleDisconnect(socket: RealtimeSocket): void {
    this.clearExpiry(socket.id);
  }

  // ---- IChatRealtimePort ----

  emitToChat<E extends ChatRealtimeEvent>(
    chatId: string,
    event: E,
    payload: ChatRealtimePayload<E>,
  ): void {
    this.emitToRoom(chatRoom(chatId), event, payload);
  }

  emitToUser<E extends ChatRealtimeEvent>(
    userId: string,
    event: E,
    payload: ChatRealtimePayload<E>,
  ): void {
    this.emitToRoom(userRoom(userId), event, payload);
  }

  joinUserToChat(userId: string, chatId: string): void {
    this.server.in(userRoom(userId)).socketsJoin(chatRoom(chatId));
  }

  removeUserFromChat(userId: string, chatId: string): void {
    this.server.in(userRoom(userId)).socketsLeave(chatRoom(chatId));
  }

  isUserViewingChat(userId: string, chatId: string): boolean {
    // Synchronous lookup: valid for the default in-memory adapter (one instance).
    const socketIds = this.server.adapter.rooms.get(userRoom(userId));
    if (!socketIds) return false;
    for (const id of socketIds) {
      if (this.server.sockets.get(id)?.data.viewingChatId === chatId) {
        return true;
      }
    }
    return false;
  }

  emitTypingStopped(chatId: string, user: IChatUser): void {
    try {
      this.broadcastTyping(chatId, user, false);
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to emit typing stop for chat ${chatId}: ${String(err)}`,
      );
    }
  }

  // ---- Client to server ----

  @SubscribeMessage('chat:view')
  async handleChatView(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: { chatId?: unknown } | undefined,
    @Ack() ack: (res: { ok: true } | IRealtimeAckError) => void,
  ): Promise<void> {
    if (!(await this.ensureSessionActive(socket, ack))) return;

    const chatId = typeof body?.chatId === 'string' ? body.chatId : null;
    socket.data.viewingChatId =
      chatId !== null && socket.rooms.has(chatRoom(chatId)) ? chatId : null;
    this.reply(ack, { ok: true });
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: { chatId?: unknown } | undefined,
  ): Promise<void> {
    if (!(await this.ensureSessionActive(socket))) return;
    const chatId = this.typingChatId(socket, body);
    if (!chatId) return;

    const relayedAt = (socket.data.typingRelayedAt ??= new Map<
      string,
      number
    >());
    const now = Date.now();
    const last = relayedAt.get(chatId);
    if (last !== undefined && now - last < TYPING_THROTTLE_MS) return;
    relayedAt.set(chatId, now);

    await this.relayTyping(chatId, socket.data.userId, true, socket);
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: { chatId?: unknown } | undefined,
  ): Promise<void> {
    if (!(await this.ensureSessionActive(socket))) return;
    const chatId = this.typingChatId(socket, body);
    if (!chatId) return;

    // The next start after a stop is relayed immediately.
    socket.data.typingRelayedAt?.delete(chatId);
    await this.relayTyping(chatId, socket.data.userId, false, socket);
  }

  @SubscribeMessage('auth:renew')
  async handleAuthRenew(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: { token?: unknown } | undefined,
    @Ack() ack: RenewAck,
  ): Promise<void> {
    if (!(await this.ensureSessionActive(socket, ack))) return;

    const token = typeof body?.token === 'string' ? body.token : undefined;
    const result = await this.verifier.verify(token);
    const { userId, sid } = socket.data;

    if (
      !result.ok ||
      result.payload.sub !== userId ||
      (sid !== null && result.payload.sid !== sid)
    ) {
      const reason = result.ok ? 'mismatch' : result.reason;
      this.reply(ack, {
        ok: false,
        error: {
          code: 'unauthorized',
          message: `Token renewal failed: ${reason}`,
        },
      });
      socket.disconnect(true);
      return;
    }

    socket.data.jti = result.payload.jti;
    socket.data.sid = result.payload.sid ?? null;
    socket.data.exp = result.payload.exp;
    this.scheduleExpiry(socket);

    this.reply(ack, {
      ok: true,
      expiresAt: new Date(result.payload.exp * 1000).toISOString(),
    });
  }

  // ---- Helpers ----

  /**
   * Re-checks the blacklist for the socket's current `jti` (one `EXISTS`).
   * Every client-to-server handler calls it first, so a missed pub/sub
   * revocation is still caught. Revoked: emits `session:expired` and
   * disconnects. Redis down: fails closed with an `unavailable` ack.
   */
  async ensureSessionActive(
    socket: RealtimeSocket,
    ack?: (res: IRealtimeAckError) => void,
  ): Promise<boolean> {
    let revoked: boolean;
    try {
      revoked =
        (await this.redis.exists(
          RedisKeys.accessBlacklist(socket.data.jti),
        )) === 1;
    } catch {
      this.reply(ack, {
        ok: false,
        error: { code: 'unavailable', message: 'Session check unavailable' },
      });
      return false;
    }

    if (revoked) {
      this.reply(ack, {
        ok: false,
        error: { code: 'unauthorized', message: 'Session revoked' },
      });
      socket.emit('session:expired', { reason: 'revoked' });
      socket.disconnect(true);
      return false;
    }
    return true;
  }

  /** Chat id from a typing payload, only when the socket is in its room. */
  private typingChatId(
    socket: RealtimeSocket,
    body: { chatId?: unknown } | undefined,
  ): string | null {
    const chatId = typeof body?.chatId === 'string' ? body.chatId : null;
    return chatId && socket.rooms.has(chatRoom(chatId)) ? chatId : null;
  }

  /**
   * Broadcasts a typing state to the chat room except every socket of the
   * typer. The typer's profile is resolved once per socket. Nothing is stored.
   */
  private async relayTyping(
    chatId: string,
    userId: string,
    isTyping: boolean,
    socket?: RealtimeSocket,
  ): Promise<void> {
    let user = socket?.data.typingUser;
    if (!user) {
      user = (await this.directory.getUsers([userId])).get(userId);
      if (!user) return;
      if (socket) socket.data.typingUser = user;
    }
    this.broadcastTyping(chatId, user, isTyping);
  }

  private broadcastTyping(
    chatId: string,
    user: IChatUser,
    isTyping: boolean,
  ): void {
    this.server
      .to(chatRoom(chatId))
      .except(userRoom(user.userId))
      .emit('typing', { chatId, user, isTyping });
  }

  private emitToRoom<E extends ChatRealtimeEvent>(
    room: string,
    event: E,
    payload: ChatRealtimePayload<E>,
  ): void {
    // The typed emit can't resolve a generic event's parameters; the public
    // signatures above keep callers type-safe.
    const target = this.server.to(room) as unknown as {
      emit(ev: string, data: unknown): boolean;
    };
    target.emit(event, payload);
  }

  private scheduleExpiry(socket: RealtimeSocket): void {
    this.clearExpiry(socket.id);
    const delay = Math.min(
      Math.max(socket.data.exp * 1000 - Date.now(), 0),
      MAX_TIMER_MS,
    );
    const timer = setTimeout(() => {
      this.expiryTimers.delete(socket.id);
      socket.emit('session:expired', { reason: 'expired' });
      socket.disconnect(true);
    }, delay);
    timer.unref?.();
    this.expiryTimers.set(socket.id, timer);
  }

  private clearExpiry(socketId: string): void {
    const timer = this.expiryTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(socketId);
    }
  }

  private reply<T>(ack: ((res: T) => void) | undefined, res: T): void {
    if (typeof ack === 'function') ack(res);
  }
}
