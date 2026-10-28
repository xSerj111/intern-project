import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { HealthController } from './health.controller';
import { InternalTokenGuard } from './internal-token.guard';
import { MetricsController } from './metrics.controller';
import { MetricsModule } from './metrics.module';

/**
 * `/health` (public), `/health/details` and `/metrics` (internal token).
 * NotificationsModule is imported for the exported MAILER (SMTP check).
 * Redis, messaging and TypeORM come from their global modules.
 */
@Module({
  imports: [MetricsModule, NotificationsModule],
  controllers: [HealthController, MetricsController],
  providers: [InternalTokenGuard],
})
export class ObservabilityModule {}
