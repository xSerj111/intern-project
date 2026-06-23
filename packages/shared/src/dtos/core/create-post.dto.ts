import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";

export class CreatePostDto {
  // Note: We pass authorId in the body for now.
  // Later, we will extract this securely from the JWT token via Auth Guards!
  @IsUUID()
  authorId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  content!: string;
}