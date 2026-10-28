import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { NotificationsRelayConsumer } from './notifications-relay.consumer';

/**
 * Relays notification events from the broker to connected browsers. Imports
 * `ChatsModule` for `CHAT_REALTIME_PORT`; the AMQP connection comes from the
 * global `MessagingModule`. Stores nothing.
 */
@Module({
  imports: [ChatsModule],
  providers: [NotificationsRelayConsumer],
})
export class NotificationsRelayModule {}
