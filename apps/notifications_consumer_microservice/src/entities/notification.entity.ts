import { TypeormEntityBase } from '@repo/shared';
import { Entity, Column, Index } from 'typeorm';

export enum NotificationType {
  FOLLOW = 'FOLLOW',
  MENTION_POST = 'MENTION_POST',
  MENTION_COMMENT = 'MENTION_COMMENT',
}

@Entity('notifications')
export class Notification extends TypeormEntityBase {
  // ID uzytkownika, ktory OTRZYMUJE powiadomienie
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  // ID uzytkownika, ktory WYWOLAL akcje (np. ten kto zaobserwowal)
  @Column({ type: 'uuid' })
  actorId!: string;

  @Column({ type: 'enum', enum: NotificationType })
  type!: NotificationType;

  // Opcjonalne ID zrodla: np. ID posta lub ID komentarza, w ktorym oznaczono uzytkownika
  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  static create(props: {
    userId: string;
    actorId: string;
    type: NotificationType;
    sourceId?: string;
  }): Notification {
    const notification = new Notification();
    notification.userId = props.userId;
    notification.actorId = props.actorId;
    notification.type = props.type;
    notification.sourceId = props.sourceId || null;
    notification.isRead = false;
    return notification;
  }

  markAsRead(): void {
    this.isRead = true;
  }
}
