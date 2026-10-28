import { Global, Module } from '@nestjs/common';
import { EVENT_BUS } from '../../modules/notifications/domain/interfaces/event-bus.port';
import {
  AMQP_CONNECTION,
  AmqpConnectionLifecycle,
  amqpConnectionProvider,
} from './amqp-connection.provider';
import { AmqpConsumerHost } from './amqp-consumer-host';
import { AmqpEventBusAdapter } from './amqp-event-bus.adapter';
import { CONSUMER_REGISTRY } from './consumer.types';

/**
 * RabbitMQ access for the notifications service: the confirm-channel
 * publisher (EVENT_BUS) and the consumer registry (CONSUMER_REGISTRY) that
 * handlers register with in `onModuleInit`. Global, so feature modules inject
 * both tokens without importing this module. `useClass` (not `useExisting`)
 * so each lifecycle hook runs on exactly one instance.
 */
@Global()
@Module({
  providers: [
    amqpConnectionProvider,
    AmqpConnectionLifecycle,
    { provide: EVENT_BUS, useClass: AmqpEventBusAdapter },
    { provide: CONSUMER_REGISTRY, useClass: AmqpConsumerHost },
  ],
  // AMQP_CONNECTION is exported read-only for the broker health check.
  exports: [EVENT_BUS, CONSUMER_REGISTRY, AMQP_CONNECTION],
})
export class MessagingModule {}
