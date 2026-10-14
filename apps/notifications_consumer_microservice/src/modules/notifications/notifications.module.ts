import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferencesModule } from '../preferences/preferences.module';
import { MessageAlertHandler } from './application/message-alert.handler';
import { EmailWorker } from './application/email.worker';
import { SocialEventHandler } from './application/social-event.handler';
import { EmailDelivery } from './domain/entities/email-delivery.entity';
import { Notification } from './domain/entities/notification.entity';
import { ProcessedEvent } from './domain/entities/processed-event.entity';
import { RecipientContact } from './domain/entities/recipient-contact.entity';
import { EMAIL_DELIVERY_REPOSITORY } from './domain/interfaces/email-delivery-repository.port';
import { MAILER } from './domain/interfaces/mailer.port';
import { NOTIFICATION_REPOSITORY } from './domain/interfaces/notification-repository.port';
import { PROCESSED_EVENT_REPOSITORY } from './domain/interfaces/processed-event-repository.port';
import { RECIPIENT_CONTACT_REPOSITORY } from './domain/interfaces/recipient-contact-repository.port';
import { RECIPIENT_DIRECTORY } from './domain/interfaces/recipient-directory.port';
import { AuthDirectoryAdapter } from './infrastructure/auth-directory.adapter';
import { NodemailerAdapter } from './infrastructure/mail/nodemailer.adapter';
import { EmailDeliveryRepository } from './infrastructure/repository/email-delivery.repository';
import { NotificationRepository } from './infrastructure/repository/notification.repository';
import { ProcessedEventRepository } from './infrastructure/repository/processed-event.repository';
import { RecipientContactRepository } from './infrastructure/repository/recipient-contact.repository';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Notifications feed (HTTP) and the broker consumers. EVENT_BUS and
 * CONSUMER_REGISTRY come from the global MessagingModule; the handlers
 * register with the registry in `onModuleInit`, and consuming starts in the
 * consumer host's `onApplicationBootstrap`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      ProcessedEvent,
      EmailDelivery,
      RecipientContact,
    ]),
    PreferencesModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_REPOSITORY, useClass: NotificationRepository },
    { provide: PROCESSED_EVENT_REPOSITORY, useClass: ProcessedEventRepository },
    { provide: EMAIL_DELIVERY_REPOSITORY, useClass: EmailDeliveryRepository },
    {
      provide: RECIPIENT_CONTACT_REPOSITORY,
      useClass: RecipientContactRepository,
    },
    { provide: RECIPIENT_DIRECTORY, useClass: AuthDirectoryAdapter },
    { provide: MAILER, useClass: NodemailerAdapter },
    SocialEventHandler,
    MessageAlertHandler,
    EmailWorker,
  ],
})
export class NotificationsModule {}
