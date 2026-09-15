import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { FeedQueryDto } from './feed-query.dto';
import { ApiProperty } from '@nestjs/swagger';

export class SearchQueryDto extends FeedQueryDto {
  @ApiProperty({ description: 'Search keyword for post content', minLength: 3 })
  @MinLength(3)
  @IsString()
  @IsNotEmpty()
  keyword!: string;
}
