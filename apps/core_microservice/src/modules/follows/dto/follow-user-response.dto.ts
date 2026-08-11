import { ApiProperty } from '@nestjs/swagger';
import { Follow } from '../domain/entities/follow.entity';
import { UserProfileDto } from '../domain/interfaces/user-profile.port';

export class FollowUserResponseDto {
  @ApiProperty()
  id: string; // ID relacji follow

  @ApiProperty()
  userId: string; // ID uzytkownika, ktorego profil wyswietlamy

  @ApiProperty()
  username: string;

  @ApiProperty({ required: false })
  avatarUrl?: string | null;

  @ApiProperty()
  followedAt: string;

  constructor(follow: Follow, profile: UserProfileDto, isFollower: boolean) {
    this.id = follow.id;
    // Jesli mapujemy liste followersow, interesuje nas followerId. Jesli liste following, interesuje nas followingId.
    this.userId = isFollower ? follow.followerId : follow.followingId;
    this.username = profile.username;
    this.avatarUrl = profile.avatarUrl;
    this.followedAt = follow.createdAt.toISOString();
  }
}
