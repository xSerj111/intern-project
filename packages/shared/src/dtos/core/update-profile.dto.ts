import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateProfileDto {
  @ApiProperty({
    description: "The content of the bio messeage",
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MaxLength(160, { message: "Bio cannot exceed 160 characters" })
  bio?: string;
}
