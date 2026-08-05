import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Post, PostStatus } from '../domain/entities/post.entity';

/** Response DTO for a post, built from the entity in its constructor. */
export class PostAssetResponseDto {
  @ApiProperty()
  assetId!: string;

  @ApiProperty()
  displayOrder!: number;
}

export class PostResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  authorId: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ enum: PostStatus })
  status: PostStatus;

  @ApiPropertyOptional({ type: [PostAssetResponseDto] })
  assets?: PostAssetResponseDto[];

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiProperty({ description: 'Total number of likes' })
  likesCount!: number;

  @ApiProperty({ description: 'Whether the current user liked this post' })
  isLiked!: boolean;

  constructor(post: Post, extras?: { likesCount: number; isLiked: boolean }) {
    this.id = post.id;
    this.authorId = post.authorId;
    this.content = post.content;
    this.status = post.status;
    this.createdAt = post.createdAt.toISOString();
    this.updatedAt = post.updatedAt.toISOString();
    this.likesCount = extras?.likesCount ?? 0;
    this.isLiked = extras?.isLiked ?? false;

    if (post.assets && post.assets.length > 0) {
      this.assets = post.assets
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((asset) => ({
          assetId: asset.assetId,
          displayOrder: asset.displayOrder,
        }));
    }
  }
}
