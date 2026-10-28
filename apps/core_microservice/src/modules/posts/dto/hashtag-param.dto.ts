import { ApiProperty } from '@nestjs/swagger';
import {
  HASHTAG_MAX_LENGTH,
  HASHTAG_TAG_PATTERN_SOURCE,
  normalizeHashtag,
} from '@repo/contracts';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

/** `:tag` path param of `GET /hashtags/:tag/posts`. */
export class HashtagParamDto {
  @ApiProperty({
    description: `Hashtag, with or without a leading # (use %23). Normalized (NFC, lowercase); 1-${HASHTAG_MAX_LENGTH} letters, digits or underscores`,
    example: 'café',
    minLength: 1,
    maxLength: HASHTAG_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeHashtag(value) : value,
  )
  @Matches(new RegExp(HASHTAG_TAG_PATTERN_SOURCE, 'u'), {
    message: 'tag must be 1-50 letters, digits or underscores',
  })
  tag!: string;
}
