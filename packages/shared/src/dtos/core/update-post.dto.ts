import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdatePostDto {
  @ApiProperty({
    example: 'Just set up my new microservice architecture! #NestJS',
    description: 'The new text content of the post',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;
}