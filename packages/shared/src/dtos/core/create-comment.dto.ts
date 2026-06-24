import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateCommentDto {

  @ApiProperty({
      example: '123e4567-e89b-12d3-a456-426614174000',
      description: 'The UUID of the author creating the post',
    })
  @IsUUID()
  authorId!: string;


  @ApiProperty({      
      description: 'The UUID of the post',
    })
  @IsUUID()
  postId!: string; // We must know which post they are commentng on!

  @ApiProperty({      
      description: 'The content of the comment',
      maxLength: 300,
    })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300, { message: 'Comments cannot exceed 300 characters' })
  content!: string;

  // Option ID of the comment being replied to
  @ApiProperty({      
      description: 'The UUID of the parent comment',      
    })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}