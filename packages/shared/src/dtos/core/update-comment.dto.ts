import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  content?: string;
}