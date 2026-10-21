import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { IHealthReport, IHealthStatus } from '@repo/contracts';
import { httpStatusFor, runHealthChecks, type HealthCheck } from '@repo/shared';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { AMQP_CONNECTION } from '../messaging/amqp-connection.provider';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MAILER } from '../../modules/notifications/domain/interfaces/mailer.port';
import { InternalTokenGuard } from './internal-token.guard';

/** The mailer's connectivity probe (`transporter.verify()`). */
export interface SmtpVerifier {
  verify(): Promise<unknown>;
}

export class BrokerDisconnectedError extends Error {}

const SERVICE = 'notifications';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  private readonly checks: HealthCheck[];

  constructor(
    @InjectDataSource() dataSource: DataSource,
    @Inject(REDIS_CLIENT) redis: Redis,
    @Inject(AMQP_CONNECTION) amqp: AmqpConnectionManager,
    @Inject(MAILER) mailer: SmtpVerifier,
  ) {
    this.checks = [
      {
        name: 'database',
        critical: true,
        run: async () => {
          await dataSource.query('SELECT 1');
        },
      },
      {
        name: 'session_redis',
        critical: true,
        run: async () => {
          await redis.ping();
        },
      },
      {
        // Consuming is this service's purpose, so a lost broker is critical.
        name: 'broker',
        critical: true,
        run: () =>
          amqp.isConnected()
            ? Promise.resolve()
            : Promise.reject(new BrokerDisconnectedError()),
      },
      {
        name: 'smtp',
        critical: false,
        run: async () => {
          await mailer.verify();
        },
      },
    ];
  }

  /** Public probe: overall status only, never dependency names or errors. */
  @Get()
  async health(
    @Res({ passthrough: true }) res: Response,
  ): Promise<IHealthStatus> {
    const report = await runHealthChecks(SERVICE, this.checks);
    res.status(httpStatusFor(report.status));
    return { status: report.status };
  }

  @Get('details')
  @UseGuards(InternalTokenGuard)
  async details(
    @Res({ passthrough: true }) res: Response,
  ): Promise<IHealthReport> {
    const report = await runHealthChecks(SERVICE, this.checks);
    res.status(httpStatusFor(report.status));
    return report;
  }
}
