import { Module } from '@nestjs/common';
import { HealthController, HEALTH_CHECKS } from './health.controller';
import { InternalTokenGuard } from './internal-token.guard';
import { MetricsController } from './metrics.controller';
import { BrokerCheck } from './checks/broker.check';
import { CacheRedisCheck } from './checks/cache-redis.check';
import { DatabaseCheck } from './checks/database.check';
import { ObjectStorageCheck } from './checks/object-storage.check';
import { SessionRedisCheck } from './checks/session-redis.check';

/**
 * `/health`, `/health/details` and `/metrics`. Deliberately has no JWT guard:
 * `JwtAuthGuard` is applied per controller, never globally. Dependencies come
 * from global modules (config, metrics, redis, cache, messaging, TypeORM).
 */
@Module({
  controllers: [HealthController, MetricsController],
  providers: [
    InternalTokenGuard,
    DatabaseCheck,
    SessionRedisCheck,
    CacheRedisCheck,
    BrokerCheck,
    ObjectStorageCheck,
    {
      provide: HEALTH_CHECKS,
      inject: [
        DatabaseCheck,
        SessionRedisCheck,
        CacheRedisCheck,
        BrokerCheck,
        ObjectStorageCheck,
      ],
      useFactory: (...checks: unknown[]) => checks,
    },
  ],
})
export class ObservabilityModule {}
