import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { ICreateProfileRequest } from '@repo/contracts';

/**
 * Request DTO for creating a profile. Implements the shared `ICreateProfileRequest`
 * contract (consumed by the frontend) and carries the validation rules.
 */
export class CreateProfileDto implements ICreateProfileRequest {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  authUserId!: string;

  @ApiProperty({ example: 'john_doe' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  handle!: string;
}
