import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import amqp from 'amqp-connection-manager';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import { AppConfigService } from '../../config/app-config.service';

export const AMQP_CONNECTION = Symbol.for('AMQP_CONNECTION');

/**
 * Auto-reconnecting RabbitMQ connection. Never throws on an unreachable broker:
 * it keeps retrying in the background, so outbox rows simply pile up meanwhile.
 */
export const amqpConnectionProvider: Provider = {
  provide: AMQP_CONNECTION,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): AmqpConnectionManager => {
    const logger = new Logger('AMQP');
    const connection = amqp.connect([config.rabbitmq.url], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 5,
    });
    connection.on('connect', () => logger.log('RabbitMQ connected'));
    connection.on('disconnect', ({ err }: { err: Error }) =>
      logger.warn(`RabbitMQ disconnected: ${err?.message ?? 'unknown reason'}`),
    );
    connection.on('connectFailed', ({ err }: { err: Error }) =>
      logger.warn(
        `RabbitMQ connect failed: ${err?.message ?? 'unknown reason'}`,
      ),
    );
    return connection;
  },
};

/**
 * Closes the shared connection on shutdown so no handles are left open.
 * Runs in `onApplicationShutdown`, after every `onModuleDestroy` hook, so the
 * channels on this connection (e.g. `AmqpEventBus`) are closed first.
 */
@Injectable()
export class AmqpConnectionLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(AMQP_CONNECTION) private readonly connection: AmqpConnectionManager,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
