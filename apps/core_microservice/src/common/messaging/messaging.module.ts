import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AmqpConnectionLifecycle,
  amqpConnectionProvider,
} from './amqp-connection.provider';
import { AmqpEventBus } from './amqp-event-bus';
import { EVENT_BUS } from './event-bus.port';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxRelay } from './outbox-relay';
import { OUTBOX_PORT } from './outbox.port';
import { TypeOrmOutboxAdapter } from './typeorm-outbox.adapter';

/**
 * Hosts the relay apart from the AMQP providers on purpose: Nest destroys
 * global modules last, so this (non-global) module's `OutboxRelay` stops and
 * finishes its in-flight publish before `MessagingModule` closes the channel
 * and connection. OUTBOX_PORT / EVENT_BUS resolve via the global export.
 */
@Module({
  providers: [OutboxRelay],
})
export class OutboxRelayModule {}

/**
 * Broker access for core: the transactional outbox (OUTBOX_PORT, one shared
 * adapter instance, since it holds the relay's wake listeners) and the
 * confirm-channel event bus (EVENT_BUS). Global so feature services can write
 * outbox rows inside their own transactions without importing this module.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent]), OutboxRelayModule],
  providers: [
    amqpConnectionProvider,
    AmqpConnectionLifecycle,
    { provide: EVENT_BUS, useClass: AmqpEventBus },
    { provide: OUTBOX_PORT, useClass: TypeOrmOutboxAdapter },
  ],
  exports: [OUTBOX_PORT, EVENT_BUS],
})
export class MessagingModule {}
