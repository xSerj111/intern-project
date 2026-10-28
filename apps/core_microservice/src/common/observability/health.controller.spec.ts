import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { HealthCheck } from '@repo/shared';
import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { HealthController } from './health.controller';
import { InternalTokenGuard } from './internal-token.guard';

const TOKEN = 'x'.repeat(32);
const NAMES = [
  ['database', true],
  ['session_redis', true],
  ['cache_redis', false],
  ['broker', false],
  ['object_storage', false],
] as const;

function checks(down: string[] = []): HealthCheck[] {
  return NAMES.map(([name, critical]) => ({
    name,
    critical,
    run: () =>
      down.includes(name)
        ? Promise.reject(new Error('postgres://u:secret@host/db'))
        : Promise.resolve(),
  }));
}

function fakeRes() {
  const status = jest.fn();
  return { res: { status } as unknown as Response, status };
}

describe('HealthController', () => {
  it('public body contains only status', async () => {
    const { res, status } = fakeRes();
    const body = await new HealthController(checks()).status(res);

    expect(body).toEqual({ status: 'healthy' });
    expect(status).toHaveBeenCalledWith(200);
  });

  it('public body hides failing dependencies', async () => {
    const { res, status } = fakeRes();
    const body = await new HealthController(checks(['cache_redis'])).status(
      res,
    );

    expect(Object.keys(body)).toEqual(['status']);
    expect(body.status).toBe('degraded');
    expect(status).toHaveBeenCalledWith(200);
  });

  it('details returns all five checks', async () => {
    const { res } = fakeRes();
    const report = await new HealthController(checks()).details(res);

    expect(report.service).toBe('core');
    expect(Object.keys(report.checks)).toEqual(NAMES.map(([n]) => n));
    expect(report.checks.database).toMatchObject({
      status: 'up',
      critical: true,
    });
    expect(report.checks.cache_redis.critical).toBe(false);
  });

  it('details never leaks error messages', async () => {
    const report = await new HealthController(checks(['broker'])).details(
      fakeRes().res,
    );

    expect(report.checks.broker.status).toBe('down');
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('unhealthy maps to 503 on both endpoints', async () => {
    const controller = new HealthController(checks(['database']));
    const pub = fakeRes();
    const det = fakeRes();

    expect((await controller.status(pub.res)).status).toBe('unhealthy');
    expect((await controller.details(det.res)).status).toBe('unhealthy');
    expect(pub.status).toHaveBeenCalledWith(503);
    expect(det.status).toHaveBeenCalledWith(503);
  });

  it('a hanging check times out instead of blocking the probe', async () => {
    const hanging: HealthCheck = {
      name: 'cache_redis',
      critical: false,
      run: () => new Promise<void>(() => undefined),
    };
    const { res, status } = fakeRes();
    const report = await new HealthController([hanging]).details(res);

    expect(report.checks.cache_redis).toMatchObject({
      status: 'down',
      error: 'timeout',
    });
    expect(status).toHaveBeenCalledWith(200);
  });
});

describe('InternalTokenGuard', () => {
  const contextWith = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;
  const guardFor = (token?: string) =>
    new InternalTokenGuard({ internalApiToken: token } as AppConfigService);

  it('accepts the right token', () => {
    expect(
      guardFor(TOKEN).canActivate(contextWith({ 'x-internal-token': TOKEN })),
    ).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['wrong', { 'x-internal-token': 'nope' }],
  ])('rejects a %s header with 401 Unauthorized', (_, headers) => {
    expect(() => guardFor(TOKEN).canActivate(contextWith(headers))).toThrow(
      new UnauthorizedException('Unauthorized'),
    );
  });

  it('rejects everything when no token is configured', () => {
    expect(() =>
      guardFor(undefined).canActivate(contextWith({ 'x-internal-token': '' })),
    ).toThrow(UnauthorizedException);
  });
});
