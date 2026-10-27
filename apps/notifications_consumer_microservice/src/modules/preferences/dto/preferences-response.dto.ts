import { ApiProperty } from '@nestjs/swagger';
import type { NotificationPreferences } from '../domain/entities/notification-preferences.entity';

/** Wire shape of `INotificationPreferences` (`@repo/contracts`). */
export class PreferencesResponseDto {
  @ApiProperty({ description: 'Email on new chat messages.' })
  emailMessages: boolean;

  @ApiProperty({ description: 'Email on comments on your posts.' })
  emailComments: boolean;

  @ApiProperty({ description: 'Email on likes.' })
  emailLikes: boolean;

  @ApiProperty({ description: 'Email on new followers.' })
  emailFollows: boolean;

  constructor(prefs: NotificationPreferences) {
    this.emailMessages = prefs.emailMessages;
    this.emailComments = prefs.emailComments;
    this.emailLikes = prefs.emailLikes;
    this.emailFollows = prefs.emailFollows;
  }
}
