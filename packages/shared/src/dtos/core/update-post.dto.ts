import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;
}