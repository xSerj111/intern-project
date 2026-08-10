import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Comment } from '../domain/entities/comment.entity';

/** Response DTO for a comment, built from the entity in its constructor. */
export class CommentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  postId: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  parentId?: string | null;

  @ApiProperty()
  authorId: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiProperty()
  likesCount!: number;

  @ApiProperty()
  isLiked!: boolean;

  @ApiProperty({ type: () => CommentResponseDto, isArray: true })
  replies?: CommentResponseDto[];

  constructor(
    comment: Comment,
    likesCount: number = 0,
    isLiked: boolean = false,
  ) {
    this.id = comment.id;
    this.postId = comment.postId;
    this.parentId = comment.parentId ?? null;
    this.authorId = comment.authorId;
    this.content = comment.content;
    this.createdAt = comment.createdAt.toISOString();
    this.updatedAt = comment.updatedAt.toISOString();
    this.likesCount = likesCount;
    this.isLiked = isLiked;
    this.replies = [];
  }
}
