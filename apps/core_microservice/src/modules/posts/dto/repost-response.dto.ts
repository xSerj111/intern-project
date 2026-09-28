import { ApiProperty } from '@nestjs/swagger';
import type { IAuthorSummary, IRepostResponse } from '@repo/contracts';
import type { Repost } from '../domain/entities/repost.entity';
import type { Post } from '../domain/entities/post.entity';
import { PostResponseDto, type PostEngagement } from './post-response.dto';

/** Response DTO for a re-post feed item. */
export class RepostResponseDto implements IRepostResponse {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Who re-posted the original post' })
  repostAuthor: IAuthorSummary;

  @ApiProperty({ type: PostResponseDto, nullable: true })
  post: PostResponseDto | null;

  @ApiProperty()
  createdAt: string;

  constructor(repost: Repost, post: Post | null, engagement?: PostEngagement) {
    this.id = repost.id;
    this.repostAuthor = {
      id: repost.author?.authUserId ?? repost.authorId,
      username: repost.author?.username ?? '',
      displayName: repost.author?.displayName ?? '',
      avatarUrl: repost.author?.avatarUrl ?? null,
    };
    this.post = post ? new PostResponseDto(post, engagement) : null;
    this.createdAt = repost.createdAt.toISOString();
  }
}
