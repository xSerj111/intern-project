import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** `PUT /notifications/preferences` body (mirrors `INotificationPreferences`); all four are required. */
export class UpdatePreferencesDto {
  @ApiProperty({ description: 'Email on new chat messages.' })
  @IsBoolean()
  emailMessages!: boolean;

  @ApiProperty({ description: 'Email on comments on your posts.' })
  @IsBoolean()
  emailComments!: boolean;

  @ApiProperty({ description: 'Email on likes.' })
  @IsBoolean()
  emailLikes!: boolean;

  @ApiProperty({ description: 'Email on new followers.' })
  @IsBoolean()
  emailFollows!: boolean;
}
