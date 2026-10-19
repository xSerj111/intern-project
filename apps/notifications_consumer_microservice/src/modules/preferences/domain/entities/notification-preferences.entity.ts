import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { NotificationKind } from '@repo/shared';

export interface EmailPreferenceSwitches {
  emailMessages: boolean;
  emailComments: boolean;
  emailLikes: boolean;
  emailFollows: boolean;
}

/**
 * Per-user email switches. A missing row means all switches are on (FR-037),
 * so rows are created lazily from {@link NotificationPreferences.defaults}.
 */
@Entity('notification_preferences')
export class NotificationPreferences implements EmailPreferenceSwitches {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_notification_preferences_userId',
  })
  userId!: string;

  /** New-message alerts. */
  @Column({ type: 'boolean', default: true })
  emailMessages!: boolean;

  /** `POST_COMMENTED` */
  @Column({ type: 'boolean', default: true })
  emailComments!: boolean;

  /** `POST_LIKED`, `COMMENT_LIKED` */
  @Column({ type: 'boolean', default: true })
  emailLikes!: boolean;

  /** `USER_FOLLOWED` */
  @Column({ type: 'boolean', default: true })
  emailFollows!: boolean;

  @UpdateDateColumn()
  updatedAt!: Date;

  static defaults(userId: string): NotificationPreferences {
    const prefs = new NotificationPreferences();
    prefs.userId = userId;
    prefs.emailMessages = true;
    prefs.emailComments = true;
    prefs.emailLikes = true;
    prefs.emailFollows = true;
    return prefs;
  }

  allowsEmailFor(kind: NotificationKind | 'NEW_MESSAGE'): boolean {
    switch (kind) {
      case 'NEW_MESSAGE':
        return this.emailMessages;
      case 'POST_COMMENTED':
        return this.emailComments;
      case 'POST_LIKED':
      case 'COMMENT_LIKED':
        return this.emailLikes;
      case 'USER_FOLLOWED':
        return this.emailFollows;
    }
  }

  /** Applies the supplied switches; omitted ones keep their value. */
  update(prefs: Partial<EmailPreferenceSwitches>): void {
    if (prefs.emailMessages !== undefined) {
      this.emailMessages = prefs.emailMessages;
    }
    if (prefs.emailComments !== undefined) {
      this.emailComments = prefs.emailComments;
    }
    if (prefs.emailLikes !== undefined) {
      this.emailLikes = prefs.emailLikes;
    }
    if (prefs.emailFollows !== undefined) {
      this.emailFollows = prefs.emailFollows;
    }
  }
}
