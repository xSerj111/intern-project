import { ApiProperty } from '@nestjs/swagger';
import { IFollowResponse } from '@repo/contracts';
import { Follow } from '../domain/entities/follow.entity';
import { FollowStatus } from '../domain/enums/follow-status.enum';
export class FollowResponseDto implements IFollowResponse {
  @ApiProperty() id: string;
  @ApiProperty() followerId: string;
  @ApiProperty() followingId: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ enum: FollowStatus, example: FollowStatus.ACCEPTED })
  status: FollowStatus;

  constructor(follow: Follow) {
    this.id = follow.id;
    this.followerId = follow.followerId;
    this.followingId = follow.followingId;
    this.createdAt = follow.createdAt.toISOString(); // Date -> ISO string
    this.status = follow.status;
  }
}
