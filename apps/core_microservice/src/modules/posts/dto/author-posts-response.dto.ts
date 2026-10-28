import { ApiProperty } from '@nestjs/swagger';
import { PostResponseDto } from './post-response.dto';

/** Documentation shape of `GET /posts/author/:userId` (offset page with a total). */
export class AuthorPostsResponseDto {
  @ApiProperty({ type: [PostResponseDto] })
  items!: PostResponseDto[];

  @ApiProperty({ description: 'Total number of posts matching the status' })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: 'true when a further page exists' })
  hasMore!: boolean;
}
