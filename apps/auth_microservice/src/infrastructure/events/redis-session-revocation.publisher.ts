import { RedisKeys, SessionRevokedEvent, WinstonLogger } from '@repo/shared';
import { Redis } from 'ioredis';
import { ISessionRevocationPublisher } from '../../domain/interfaces/session-revocation-publisher';

export class RedisSessionRevocationPublisher implements ISessionRevocationPublisher {
  constructor(
    private readonly client: Redis,
    private readonly logger: WinstonLogger,
  ) {}

  async publish(event: SessionRevokedEvent): Promise<void> {
    try {
      await this.client.publish(RedisKeys.sessionRevokedChannel, JSON.stringify(event));
    } catch (error) {
      // Pub/sub is best-effort: logout must still succeed.
      this.logger.error('Failed to publish session revocation', { error });
    }
  }
}
