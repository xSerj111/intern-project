import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";

export class CreatePostDto {
  // Note: We pass authorId in the body for now.
  // Later, we will extract this securely from the JWT token via Auth Guards!
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'The UUID of the author creating the post',
  })
  @IsUUID()
  authorId!: string;

  @ApiProperty({
    example: 'Just set up my new microservice architecture! #NestJS',
    description: 'The text content of the post',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  content!: string;
}