import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  UPLOAD_MAX_BYTES,
  type ICreateUploadRequest,
  type UploadPurpose,
} from '@repo/contracts';

const UPLOAD_PURPOSES: readonly UploadPurpose[] = [
  'post-image',
  'avatar',
  'chat-attachment',
];

export class CreateUploadDto implements ICreateUploadRequest {
  @ApiProperty({ enum: UPLOAD_PURPOSES })
  @IsIn(UPLOAD_PURPOSES)
  purpose!: UploadPurpose;

  @ApiProperty({
    example: 'image/png',
    description: 'Declared MIME type; must be allowed for the purpose',
  })
  @IsString()
  contentType!: string;

  @ApiProperty({
    example: 204800,
    description: 'File size in bytes (1 to 10 MiB)',
    maximum: UPLOAD_MAX_BYTES,
  })
  @IsInt()
  @Min(1)
  @Max(UPLOAD_MAX_BYTES)
  size!: number;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}
