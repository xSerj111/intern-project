import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import type { IHealthReport, IHealthStatus } from '@repo/contracts';
import { HealthCheck, httpStatusFor, runHealthChecks } from '@repo/shared';
import type { Response } from 'express';
import { InternalTokenGuard } from './internal-token.guard';

export const HEALTH_CHECKS = Symbol.for('HEALTH_CHECKS');

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_CHECKS) private readonly checks: HealthCheck[]) {}

  /** Public probe: overall status only, never dependency names or errors. */
  @Get()
  async status(
    @Res({ passthrough: true }) res: Response,
  ): Promise<IHealthStatus> {
    const report = await runHealthChecks('core', this.checks);
    res.status(httpStatusFor(report.status));
    return { status: report.status };
  }

  @Get('details')
  @UseGuards(InternalTokenGuard)
  async details(
    @Res({ passthrough: true }) res: Response,
  ): Promise<IHealthReport> {
    const report = await runHealthChecks('core', this.checks);
    res.status(httpStatusFor(report.status));
    return report;
  }
}
