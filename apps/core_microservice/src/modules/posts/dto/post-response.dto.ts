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

  constructor(post: Post) {
    this.id = post.id;
    this.authorId = post.authorId;
    this.content = post.content;
    this.status = post.status;
    this.createdAt = post.createdAt.toISOString();
    this.updatedAt = post.updatedAt.toISOString();

    if (post.assets) {
      this.assets = post.assets
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((asset) => ({
          assetId: asset.assetId,
          displayOrder: asset.displayOrder,
        }));
    }
  }
}
