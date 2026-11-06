import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  HASHTAG_MAX_LENGTH,
  HASHTAG_TAG_PATTERN_SOURCE,
  PAGE_SIZE_MAX,
  normalizeHashtag,
  type ISearchHashtagsQuery,
} from '@repo/contracts';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class SearchHashtagsQueryDto implements ISearchHashtagsQuery {
  @ApiProperty({
    description: `Tag prefix, with or without a leading #. Normalized (NFC, lowercase); 1-${HASHTAG_MAX_LENGTH} letters, digits or underscores`,
    example: 'caf',
    minLength: 1,
    maxLength: HASHTAG_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeHashtag(value) : value,
  )
  @Matches(new RegExp(HASHTAG_TAG_PATTERN_SOURCE, 'u'), {
    message: 'q must be 1-50 letters, digits or underscores',
  })
  q!: string;

  @ApiPropertyOptional({
    description: 'Maximum number of suggestions',
    default: 10,
    minimum: 1,
    maximum: PAGE_SIZE_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  limit: number = 10;
}
