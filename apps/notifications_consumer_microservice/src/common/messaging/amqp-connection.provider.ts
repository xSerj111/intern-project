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
 * Auto-reconnecting RabbitMQ connection. Never throws on an unreachable
 * broker: it keeps retrying in the background, and messages wait in their
 * durable queues meanwhile.
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
 * Closes the shared connection last: `onApplicationShutdown` runs after the
 * consumers drained (`onModuleDestroy`) and the publisher channel closed
 * (`beforeApplicationShutdown`).
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
