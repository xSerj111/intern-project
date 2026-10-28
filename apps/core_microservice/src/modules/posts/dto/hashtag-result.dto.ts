import { ApiProperty } from '@nestjs/swagger';
import type { IHashtagResult } from '@repo/contracts';

/** Documentation shape of one `GET /hashtags/search` suggestion. */
export class HashtagResultDto implements IHashtagResult {
  @ApiProperty({ description: 'Normalized tag, without #', example: 'café' })
  tag!: string;

  @ApiProperty({ description: 'Number of published posts carrying the tag' })
  postCount!: number;
}
