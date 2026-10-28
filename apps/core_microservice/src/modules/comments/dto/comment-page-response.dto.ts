import { ApiProperty } from '@nestjs/swagger';
import type { IOffsetPage } from '@repo/contracts';
import { CommentResponseDto } from './comment-response.dto';

/** Documentation shape of `GET /comments/post/:postId` (paged by root comments). */
export class CommentPageResponseDto implements Omit<
  IOffsetPage<CommentResponseDto>,
  'items'
> {
  @ApiProperty({ type: [CommentResponseDto] })
  items!: CommentResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: 'true when a further page exists' })
  hasMore!: boolean;
}
