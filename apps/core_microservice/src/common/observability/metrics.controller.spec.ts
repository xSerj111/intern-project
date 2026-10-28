import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Registry } from 'prom-client';
import { InternalTokenGuard } from './internal-token.guard';
import { MetricsController } from './metrics.controller';

describe('MetricsController', () => {
  const handler = Object.getOwnPropertyDescriptor(
    MetricsController.prototype,
    'metrics',
  )?.value as object;
  const metrics = jest.fn();
  const controller = new MetricsController({ metrics } as unknown as Registry);

  beforeEach(() => jest.resetAllMocks());

  it('returns the registry exposition text', async () => {
    metrics.mockResolvedValue('# HELP up\nup 1\n');

    await expect(controller.metrics()).resolves.toBe('# HELP up\nup 1\n');
    expect(metrics).toHaveBeenCalledTimes(1);
  });

  it('propagates registry failures', async () => {
    metrics.mockRejectedValue(new Error('collect failed'));

    await expect(controller.metrics()).rejects.toThrow('collect failed');
  });

  it('is protected by the internal token guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

    expect(guards).toContain(InternalTokenGuard);
  });

  it('serves the Prometheus text content type', () => {
    const headers = Reflect.getMetadata('__headers__', handler) as {
      name: string;
      value: string;
    }[];

    expect(headers).toContainEqual({
      name: 'Content-Type',
      value: 'text/plain; version=0.0.4; charset=utf-8',
    });
  });
});
