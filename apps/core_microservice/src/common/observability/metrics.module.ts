import { Global, Module } from '@nestjs/common';
import { createMetricsRegistry } from '@repo/shared';
import { METRICS_REGISTRY } from './metrics.tokens';

/** Process-wide Prometheus registry; global so any module can record metrics. */
@Global()
@Module({
  providers: [
    {
      provide: METRICS_REGISTRY,
      useFactory: () => createMetricsRegistry('core'),
    },
  ],
  exports: [METRICS_REGISTRY],
})
export class MetricsModule {}
