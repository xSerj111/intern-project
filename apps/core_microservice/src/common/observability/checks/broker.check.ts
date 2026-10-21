import { Inject, Injectable } from '@nestjs/common';
import type { HealthCheck } from '@repo/shared';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import { AMQP_CONNECTION } from '../../messaging/amqp-connection.provider';

@Injectable()
export class BrokerCheck implements HealthCheck {
  readonly name = 'broker';
  readonly critical = false;

  constructor(
    @Inject(AMQP_CONNECTION) private readonly connection: AmqpConnectionManager,
  ) {}

  run(): Promise<void> {
    return this.connection.isConnected()
      ? Promise.resolve()
      : Promise.reject(new Error('disconnected'));
  }
}
