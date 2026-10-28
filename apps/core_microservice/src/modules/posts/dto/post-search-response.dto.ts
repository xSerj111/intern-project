import { ApiProperty } from '@nestjs/swagger';
import { PostResponseDto } from './post-response.dto';

/** Documentation shape of `GET /posts/search` (offset page with a total). */
export class PostSearchResponseDto {
  @ApiProperty({ type: [PostResponseDto] })
  items!: PostResponseDto[];

  @ApiProperty({ description: 'Total number of matching posts' })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
