import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateCommentDto {
  @IsUUID()
  authorId!: string;

  @IsUUID()
  postId!: string; // We must know which post they are commentng on!

  @IsString()
  @IsNotEmpty()
  @MaxLength(300, { message: 'Comments cannot exceed 300 characters' })
  content!: string;
}