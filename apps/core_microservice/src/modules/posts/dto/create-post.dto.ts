import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ArrayMaxSize,
  IsArray,
} from 'class-validator';

export class CreatePostDto {
  @ApiPropertyOptional({
    example: 'Just set up my new microservice architecture! #NestJS',
    description:
      'The text content of the post. Optional so empty drafts can be saved.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;

  @ApiPropertyOptional({
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    description: 'Optional array of Asset IDs attached to the post',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(10) // Opcjonalny limit np. 10 plików na post
  assetIds?: string[];

  @ApiPropertyOptional({
    description:
      'Publish immediately. Defaults to false (save as draft). Publishing requires non-empty content.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
