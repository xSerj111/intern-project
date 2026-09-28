import { ApiProperty } from '@nestjs/swagger';
import type {
  IAuthorSummary,
  IPostMediaResponse,
  IPostResponse,
  PostStatus as ContractPostStatus,
} from '@repo/contracts';
import { Post } from '../domain/entities/post.entity';

/** Engagement counters and viewer state attached to a post response. */
export interface PostEngagement {
  likeCount: number;
  commentCount: number;
  repostCount: number;
  likedByMe: boolean;
}

/**
 * Response DTO for a post. Built from the entity (with the joined `author` and
 * `assets.asset` relations) plus optional engagement counters. Implements the
 * shared `IPostResponse` contract so the wire shape stays decoupled from the
 * schema.
 */
export class PostResponseDto implements IPostResponse {
  @ApiProperty()
  id: string;

  @ApiProperty({
    description: 'Compact author projection',
  })
  author: IAuthorSummary;

  @ApiProperty()
  content: string;

  @ApiProperty({ enum: ['draft', 'published', 'archived'] })
  status: ContractPostStatus;

  @ApiProperty({ type: [Object] })
  assets: IPostMediaResponse[];

  @ApiProperty()
  likeCount: number;

  @ApiProperty()
  commentCount: number;

  @ApiProperty()
  repostCount: number;

  @ApiProperty()
  likedByMe: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(post: Post, engagement?: Partial<PostEngagement>) {
    this.id = post.id;
    this.author = {
      id: post.author?.authUserId ?? post.authorId,
      username: post.author?.username ?? '',
      displayName: post.author?.displayName ?? '',
      avatarUrl: post.author?.avatarUrl ?? null,
    };
    this.content = post.content;
    this.status = post.status as unknown as ContractPostStatus;
    this.assets = (post.assets ?? [])
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((attachment): IPostMediaResponse => {
        const asset = attachment.asset;
        const mimeType = asset?.mimeType ?? '';
        return {
          assetId: attachment.assetId,
          url: asset?.url ?? '',
          mimeType,
          mediaType: mimeType.startsWith('video/') ? 'video' : 'image',
          displayOrder: attachment.displayOrder,
        };
      });
    this.likeCount = engagement?.likeCount ?? 0;
    this.commentCount = engagement?.commentCount ?? 0;
    this.repostCount = engagement?.repostCount ?? 0;
    this.likedByMe = engagement?.likedByMe ?? false;
    this.createdAt = post.createdAt.toISOString();
    this.updatedAt = post.updatedAt.toISOString();
  }
}
