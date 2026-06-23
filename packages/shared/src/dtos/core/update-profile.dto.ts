import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(160, { message: 'Bio cannot exceed 160 characters' })
  bio?: string;
}