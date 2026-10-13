import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import Redis from 'ioredis';
import { RedisKeys, SessionRevokedEvent } from '@repo/shared';
import {
  ChatsGateway,
  userRoom,
} from '../../modules/chats/infrastructure/realtime/chats.gateway';
import { REDIS_CLIENT } from './redis.module';

/**
 * Listens on the `auth:session-revoked` channel (published by auth on logout)
 * and closes the matching live sockets: by `sid`, or by `jti` for tokens
 * issued without a session id. Pub/sub isn't durable; the per-event blacklist
 * check and the expiry timer bound the exposure if a message is lost.
 */
@Injectable()
export class SessionRevocationListener
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('SessionRevocationListener');
  private subscriber: Redis | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly gateway: ChatsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    // A connection in subscriber mode can't run other commands, so it gets its own.
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('error', (err: Error) =>
      this.logger.error(`Redis subscriber error: ${err.message}`),
    );
    subscriber.on('message', (channel: string, message: string) => {
      if (channel !== RedisKeys.sessionRevokedChannel) return;
      this.handleMessage(message).catch((err: unknown) =>
        this.logger.error(
          `Failed to handle session revocation: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    });

    try {
      await subscriber.subscribe(RedisKeys.sessionRevokedChannel);
      this.logger.log(`Subscribed to ${RedisKeys.sessionRevokedChannel}`);
    } catch (err) {
      // Don't block startup; blacklist checks and expiry timers still apply.
      this.logger.error(
        `Could not subscribe to ${RedisKeys.sessionRevokedChannel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (!subscriber) return;
    try {
      await subscriber.unsubscribe(RedisKeys.sessionRevokedChannel);
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
  }

  async handleMessage(message: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.logger.warn('Ignoring malformed session revocation message');
      return;
    }
    if (typeof raw !== 'object' || raw === null) {
      this.logger.warn('Ignoring malformed session revocation message');
      return;
    }

    const event = plainToInstance(SessionRevokedEvent, raw);
    const errors = await validate(event);
    if (errors.length > 0) {
      this.logger.warn('Ignoring invalid session revocation message');
      return;
    }
    const { userId, sid, jti } = event;
    if (!sid && !jti) return;

    const sockets = await this.gateway.server
      .in(userRoom(userId))
      .fetchSockets();
    for (const socket of sockets) {
      const matches = sid ? socket.data.sid === sid : socket.data.jti === jti;
      if (!matches) continue;
      socket.emit('session:expired', { reason: 'revoked' });
      socket.disconnect(true);
    }
  }
}
