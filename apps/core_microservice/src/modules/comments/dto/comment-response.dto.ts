import { ApiProperty } from '@nestjs/swagger';
import { Comment } from '../domain/entities/comment.entity';

/** Response DTO for a comment, built from the entity in its constructor. */
export class CommentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  postId: string;

  @ApiProperty({ type: String, nullable: true })
  parentId: string | null;

  @ApiProperty()
  authorId: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(comment: Comment) {
    this.id = comment.id;
    this.postId = comment.postId;
    this.parentId = comment.parentId ?? null;
    this.authorId = comment.authorId;
    this.content = comment.content;
    this.createdAt = comment.createdAt.toISOString();
    this.updatedAt = comment.updatedAt.toISOString();
  }
}
