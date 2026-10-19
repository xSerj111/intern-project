import { ApiProperty } from '@nestjs/swagger';
import type { ICommentResponse } from '@repo/contracts';
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

  @ApiProperty({ description: 'Likes with deletedAt IS NULL' })
  likeCount: number;

  @ApiProperty({ description: 'false when the request is unauthenticated' })
  likedByMe: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(
    comment: Comment,
    likes: Pick<ICommentResponse, 'likeCount' | 'likedByMe'>,
  ) {
    this.id = comment.id;
    this.postId = comment.postId;
    this.parentId = comment.parentId ?? null;
    this.authorId = comment.authorId;
    this.content = comment.content;
    this.likeCount = likes.likeCount;
    this.likedByMe = likes.likedByMe;
    this.createdAt = comment.createdAt.toISOString();
    this.updatedAt = comment.updatedAt.toISOString();
  }
}
