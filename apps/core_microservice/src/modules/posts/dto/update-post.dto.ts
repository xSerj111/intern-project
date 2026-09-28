import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdatePostDto {
  @ApiPropertyOptional({
    example: 'Just set up my new microservice architecture! #NestJS',
    description: 'The new text content of the post',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;

  @ApiPropertyOptional({
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    description:
      'Ordered asset ids replacing the post media wholesale. Omit to keep media unchanged.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(10)
  assetIds?: string[];
}
