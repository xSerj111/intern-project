import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import amqp from 'amqp-connection-manager';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import { AppConfigService } from '../../config/app-config.service';
import {
  AmqpConnectionLifecycle,
  amqpConnectionProvider,
} from './amqp-connection.provider';

jest.mock('amqp-connection-manager', () => ({
  __esModule: true,
  default: { connect: jest.fn() },
}));

type Factory = (config: AppConfigService) => AmqpConnectionManager;

describe('amqpConnectionProvider', () => {
  const connect = amqp.connect as jest.Mock;
  let manager: EventEmitter & { close: jest.Mock };
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  const config = {
    rabbitmq: { url: 'amqp://guest:guest@localhost:5672' },
  } as AppConfigService;

  beforeEach(() => {
    manager = Object.assign(new EventEmitter(), {
      close: jest.fn().mockResolvedValue(undefined),
    });
    connect.mockReset().mockReturnValue(manager);
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const build = () =>
    (amqpConnectionProvider as { useFactory: Factory }).useFactory(config);

  it('connects to the configured RabbitMQ url', () => {
    expect(build()).toBe(manager);
    expect(connect).toHaveBeenCalledWith(
      [config.rabbitmq.url],
      expect.any(Object),
    );
  });

  it('logs connect and disconnect', () => {
    build();

    manager.emit('connect', {});
    manager.emit('disconnect', { err: new Error('socket closed') });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('connected'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('socket closed'));
  });

  it('closes the connection on application shutdown, not module destroy', async () => {
    const lifecycle = new AmqpConnectionLifecycle(
      manager as unknown as AmqpConnectionManager,
    );

    expect('onModuleDestroy' in lifecycle).toBe(false);
    await lifecycle.onApplicationShutdown();

    expect(manager.close).toHaveBeenCalledTimes(1);
  });
});
