import { Injectable } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostResponseDto } from './dto/post-response.dto';
import { Post } from './domain/entities/post.entity';

@Injectable()
export class PostResponseMapper {
  constructor(private readonly postsService: PostsService) {}

  /** Wraps posts with like/comment counts and the viewer's own like (one query each). */
  async toResponses(
    posts: Post[],
    viewerId?: string,
  ): Promise<PostResponseDto[]> {
    const ids = posts.map((post) => post.id);
    const [likes, commentCounts] = await Promise.all([
      this.postsService.getLikeStats(ids, viewerId),
      this.postsService.getCommentCounts(ids),
    ]);
    return posts.map(
      (post) =>
        new PostResponseDto(post, {
          ...(likes.get(post.id) ?? { likeCount: 0, likedByMe: false }),
          commentCount: commentCounts.get(post.id) ?? 0,
        }),
    );
  }

  async toResponse(post: Post, viewerId?: string): Promise<PostResponseDto> {
    return (await this.toResponses([post], viewerId))[0];
  }
}
