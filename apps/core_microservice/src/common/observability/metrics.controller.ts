import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import type { Registry } from 'prom-client';
import { InternalTokenGuard } from './internal-token.guard';
import { METRICS_REGISTRY } from './metrics.tokens';

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS_REGISTRY) private readonly registry: Registry) {}

  @Get()
  @UseGuards(InternalTokenGuard)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
