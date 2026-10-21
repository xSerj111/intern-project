import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { CACHE_STORE } from './cache-store.port';
import { ProfileSummaryCache } from './profile-summary-cache';
import { CACHE_REDIS_CLIENT, RedisCacheAdapter } from './redis-cache.adapter';

/**
 * Dedicated, disposable cache Redis (research §6). Separate from the session
 * client in `common/redis` so a cache outage never touches auth: commands
 * reject fast instead of queueing, and boot never waits for a connection.
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => {
        const client = new Redis({
          ...config.cacheRedis,
          commandTimeout: 50,
          connectTimeout: 500,
          // disconnect() arms a timer that only a stream 'close' clears; after a
          // failed connect the stream is already closed, so the default 2 s timer
          // would outlive the app (and hold a Jest worker open).
          disconnectTimeout: 0,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          retryStrategy: (n: number) => Math.min(n * 200, 2000),
        });
        // Log transitions only; reconnect attempts would otherwise log every 2 s.
        const logger = new Logger('CacheRedis');
        let down = false;
        client.on('error', (err: Error) => {
          if (down) return;
          down = true;
          logger.warn(`Cache Redis unavailable: ${err.message}`);
        });
        client.on('ready', () => {
          if (down) logger.log('Cache Redis reconnected');
          down = false;
        });
        return client;
      },
    },
    { provide: CACHE_STORE, useClass: RedisCacheAdapter },
    ProfileSummaryCache,
  ],
  exports: [CACHE_STORE, ProfileSummaryCache],
})
export class CacheModule implements OnModuleDestroy {
  constructor(@Inject(CACHE_REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    // Cache down: QUIT cannot be sent and a pending reconnect would keep the
    // process alive, so drop the socket (disconnect also cancels reconnects).
    if (this.client.status !== 'ready') {
      this.client.disconnect();
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
