import type { NotificationPreferences } from '../domain/entities/notification-preferences.entity';

/** Wire shape of `INotificationPreferences` (`@repo/contracts`). */
export class PreferencesResponseDto {
  emailMessages: boolean;
  emailComments: boolean;
  emailLikes: boolean;
  emailFollows: boolean;

  constructor(prefs: NotificationPreferences) {
    this.emailMessages = prefs.emailMessages;
    this.emailComments = prefs.emailComments;
    this.emailLikes = prefs.emailLikes;
    this.emailFollows = prefs.emailFollows;
  }
}
