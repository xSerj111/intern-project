import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { createMetricsRegistry } from '@repo/shared';
import type { Response } from 'express';
import { InternalTokenGuard } from './internal-token.guard';
import { METRICS_REGISTRY } from './metrics.tokens';

export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';

@ApiExcludeController()
@Controller('metrics')
@UseGuards(InternalTokenGuard)
export class MetricsController {
  constructor(
    @Inject(METRICS_REGISTRY)
    private readonly registry: ReturnType<typeof createMetricsRegistry>,
  ) {}

  @Get()
  async metrics(@Res() res: Response): Promise<void> {
    const body = await this.registry.metrics();
    // Raw end(): express's res.send would re-serialise the charset parameter.
    res.status(200).setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
    res.end(body);
  }
}
