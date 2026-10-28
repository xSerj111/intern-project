import { ApiProperty } from '@nestjs/swagger';
import type { ILikeState } from '@repo/contracts';

export class LikeStateDto implements ILikeState {
  @ApiProperty({ description: 'State after the call' }) liked!: boolean;
  @ApiProperty({ description: 'Current like count' }) likeCount!: number;
}
