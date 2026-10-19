import { IsBoolean } from 'class-validator';

/** `PUT /notifications/preferences` body (mirrors `INotificationPreferences`); all four are required. */
export class UpdatePreferencesDto {
  @IsBoolean()
  emailMessages!: boolean;

  @IsBoolean()
  emailComments!: boolean;

  @IsBoolean()
  emailLikes!: boolean;

  @IsBoolean()
  emailFollows!: boolean;
}
