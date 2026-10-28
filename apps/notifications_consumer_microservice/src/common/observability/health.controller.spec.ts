import type { AmqpConnectionManager } from 'amqp-connection-manager';
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const res = () => {
    const status = jest.fn();
    return { status, response: { status } as unknown as Response };
  };

  const build = (
    overrides: {
      db?: () => Promise<unknown>;
      redis?: () => Promise<unknown>;
      connected?: boolean;
      smtp?: () => Promise<unknown>;
    } = {},
  ) =>
    new HealthController(
      {
        query: overrides.db ?? (() => Promise.resolve([])),
      } as unknown as DataSource,
      { ping: overrides.redis ?? (() => Promise.resolve('PONG')) } as Redis,
      {
        isConnected: () => overrides.connected ?? true,
      } as AmqpConnectionManager,
      { verify: overrides.smtp ?? (() => Promise.resolve(true)) },
    );

  it('is healthy (200) with only a status on /health', async () => {
    const { status, response: r } = res();
    await expect(build().health(r)).resolves.toEqual({ status: 'healthy' });
    expect(status).toHaveBeenCalledWith(200);
  });

  it('reports all four checks with their criticality on /health/details', async () => {
    const report = await build().details(res().response);
    expect(report.service).toBe('notifications');
    expect(
      Object.fromEntries(
        Object.entries(report.checks).map(([k, v]) => [k, v.critical]),
      ),
    ).toEqual({
      database: true,
      session_redis: true,
      broker: true,
      smtp: false,
    });
  });

  it('is degraded (200) when only SMTP is down', async () => {
    const { status, response: r } = res();
    const out = await build({
      smtp: () =>
        Promise.reject(new Error('connect ECONNREFUSED smtp://u:p@h')),
    }).health(r);
    expect(out).toEqual({ status: 'degraded' });
    expect(status).toHaveBeenCalledWith(200);
  });

  it('is unhealthy (503) when the broker is disconnected, without leaking errors', async () => {
    const { status, response: r } = res();
    const controller = build({ connected: false });
    expect(await controller.health(r)).toEqual({ status: 'unhealthy' });
    expect(status).toHaveBeenCalledWith(503);
    const report = await controller.details(res().response);
    expect(report.checks.broker).toMatchObject({
      status: 'down',
      error: 'BrokerDisconnectedError',
    });
  });

  it('never includes connection strings in details errors', async () => {
    const report = await build({
      db: () => Promise.reject(new Error('postgres://user:secret@host/db')),
    }).details(res().response);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(report.status).toBe('unhealthy');
  });
});
