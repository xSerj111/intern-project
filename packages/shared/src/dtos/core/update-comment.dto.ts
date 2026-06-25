import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateCommentDto {
  @ApiProperty({
    //example: 'Nice job! hshdha',
    description: "The new text content of the comment",
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  content?: string;
}
