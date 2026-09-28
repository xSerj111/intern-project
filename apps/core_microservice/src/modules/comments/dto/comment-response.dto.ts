import { ApiProperty } from '@nestjs/swagger';
import type { IAuthorSummary, ICommentResponse } from '@repo/contracts';
import { Comment } from '../domain/entities/comment.entity';

/** Response DTO for a comment, built from the entity (author joined). */
export class CommentResponseDto implements ICommentResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  postId: string;

  @ApiProperty({ type: String, nullable: true })
  parentId: string | null;

  @ApiProperty()
  author: IAuthorSummary;

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
    this.author = {
      id: comment.author?.authUserId ?? comment.authorId,
      username: comment.author?.username ?? '',
      displayName: comment.author?.displayName ?? '',
      avatarUrl: comment.author?.avatarUrl ?? null,
    };
    this.content = comment.content;
    this.createdAt = comment.createdAt.toISOString();
    this.updatedAt = comment.updatedAt.toISOString();
  }
}
