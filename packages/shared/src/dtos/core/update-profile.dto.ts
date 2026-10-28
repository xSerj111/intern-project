import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";

/** Matches `DISPLAY_NAME_MAX_LENGTH` on the core `UserProfile` entity. */
const DISPLAY_NAME_MAX_LENGTH = 100;

/** Body of `PATCH /profiles/:id` (matches `IUpdateProfileRequest`). */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: "New display name (trimmed, 1-100 characters)",
    maxLength: DISPLAY_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: "Display name cannot be empty" })
  @MaxLength(DISPLAY_NAME_MAX_LENGTH, {
    message: `Display name cannot exceed ${DISPLAY_NAME_MAX_LENGTH} characters`,
  })
  displayName?: string;

  @ApiPropertyOptional({
    description: "The content of the bio message, or null to clear it",
    maxLength: 160,
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(160, { message: "Bio cannot exceed 160 characters" })
  bio?: string | null;

  @ApiPropertyOptional({
    description:
      "Id of a public image asset uploaded by the caller, or null to clear the avatar",
    type: String,
    format: "uuid",
    nullable: true,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  avatarAssetId?: string | null;
}
