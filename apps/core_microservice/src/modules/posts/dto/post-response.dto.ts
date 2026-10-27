import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IPostAssetResponse, IPostResponse } from '@repo/contracts';
import { UserSummaryDto } from '../../../common/dto/user-summary.dto';
import { Post, PostStatus } from '../domain/entities/post.entity';

/** Response DTO for a post, built from the entity in its constructor. */
export class PostAssetResponseDto implements IPostAssetResponse {
  @ApiProperty()
  assetId!: string;

  @ApiProperty()
  displayOrder!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Public URL of the asset; null if it is not publicly reachable',
  })
  url!: string | null;

  @ApiProperty()
  mimeType!: string;
}

/** Per-post counters computed in batch by the caller. */
export type PostStats = Pick<
  IPostResponse,
  'likeCount' | 'likedByMe' | 'commentCount'
>;

export class PostResponseDto implements IPostResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  authorId: string;

  @ApiProperty({
    type: UserSummaryDto,
    nullable: true,
    description: 'Author identity; null if the profile no longer exists',
  })
  author: UserSummaryDto | null;

  @ApiProperty()
  content: string;

  @ApiProperty({ enum: PostStatus })
  status: PostStatus;

  @ApiPropertyOptional({ type: [PostAssetResponseDto] })
  assets?: PostAssetResponseDto[];

  @ApiProperty({ description: 'Likes with deletedAt IS NULL' })
  likeCount: number;

  @ApiProperty({ description: 'Comments with deletedAt IS NULL' })
  commentCount: number;

  @ApiProperty({ description: 'false when the request is unauthenticated' })
  likedByMe: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(post: Post, stats: PostStats) {
    this.id = post.id;
    this.authorId = post.authorId;
    this.author = UserSummaryDto.fromProfile(post.author);
    this.content = post.content;
    this.status = post.status;
    this.likeCount = stats.likeCount;
    this.commentCount = stats.commentCount;
    this.likedByMe = stats.likedByMe;
    this.createdAt = post.createdAt.toISOString();
    this.updatedAt = post.updatedAt.toISOString();

    if (post.assets) {
      // A soft-deleted file joins as null: it can no longer be shown, so skip it.
      this.assets = [...post.assets]
        .filter((link) => link.asset)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((link) => ({
          assetId: link.assetId,
          displayOrder: link.displayOrder,
          url: link.asset.url ?? null,
          mimeType: link.asset.mimeType,
        }));
    }
  }
}
