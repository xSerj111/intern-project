import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserFollowedEvent, UserMentionedEvent } from '@repo/shared';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Notification,
  NotificationType,
} from '../entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    // Wstrzykujemy standardowe repozytorium TypeORM.
    // Jesli uzywasz portow i wlasnych repozytoriow, podmien to wedlug swoich standardow.
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  // Ten dekorator kaze frameworkowi nasluchiwac zdefiniowanego przez nas hasla!
  @OnEvent('user.followed')
  async handleUserFollowed(event: UserFollowedEvent) {
    const notification = Notification.create({
      userId: event.followingId, // Powiadomienie dostaje obserwowany
      actorId: event.followerId, // Akcje wywolal obserwujacy
      type: NotificationType.FOLLOW,
    });

    await this.notificationRepository.save(notification);
    // Opcjonalnie mozesz tu dodac logger, zeby widziec w konsoli, ze zdarzenie dotarlo
  }

  // Nasluchujemy drugiego zdarzenia z modulu komentarzy
  @OnEvent('user.mentioned')
  async handleUserMentioned(event: UserMentionedEvent) {
    const notificationType =
      event.sourceType === 'COMMENT'
        ? NotificationType.MENTION_COMMENT
        : NotificationType.MENTION_POST;

    const notification = Notification.create({
      userId: event.mentionedUserId,
      actorId: event.mentionerId,
      type: notificationType,
      sourceId: event.sourceId, // ID komentarza, zeby na frontendzie wygenerowac link "Kliknij, aby przejsc"
    });

    await this.notificationRepository.save(notification);
  }
}
