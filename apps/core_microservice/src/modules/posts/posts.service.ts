import { Inject, Injectable } from '@nestjs/common';
import { type Logger, LoggerKey, UnauthorizedError } from '@repo/shared';
import type {
  FeedType,
  MediaTypeFilter,
  PostSort,
} from '@repo/contracts';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post } from './domain/entities/post.entity';
import { PostRepository } from './infrastructure/repository/post.repository';
import { PostLikeRepository } from './infrastructure/repository/post-like.repository';
import {
  RepostRepositoryKey,
  type IRepostRepository,
} from './domain/interfaces/repost-repository.port';
import { CommentRepository } from '../comments/infrastructure/repository/comment.repository';
import { PostAsset } from './domain/entities/post-asset.entity';
import { FollowRepositoryKey } from '../follows/domain/interfaces/follow-repository.port';
import type { IFollowRepository } from '../follows/domain/interfaces/follow-repository.port';
import type { PostEngagement } from './dto/post-response.dto';

/** A post paired with its bulk-computed engagement counters. */
export interface PostWithEngagement {
  post: Post;
  engagement: PostEngagement;
}

@Injectable()
export class PostsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly postRepository: PostRepository,
    private readonly postLikeRepository: PostLikeRepository,
    @Inject(RepostRepositoryKey)
    private readonly repostRepository: IRepostRepository,
    private readonly commentRepository: CommentRepository,
    @Inject(FollowRepositoryKey)
    private readonly followRepository: IFollowRepository,
  ) {}

  async getFeed(
    userId: string,
    feed: FeedType,
    sort: PostSort,
    mediaType: MediaTypeFilter | undefined,
    page: number,
    limit: number,
  ): Promise<{ items: PostWithEngagement[]; total: number }> {
    const authorIds =
      feed === 'discover' ? undefined : await this.resolveFollowingAuthorIds(userId);

    const [posts, total] = await this.postRepository.getFeed({
      authorIds,
      sort,
      mediaType,
      page,
      limit,
    });

    const engagement = await this.attachEngagement(posts, userId);

    this.logger.debug('Feed retrieved', {
      props: { userId, feed, count: posts.length, total },
    });

    return {
      items: posts.map((post) => ({
        post,
        engagement: engagement.get(post.id)!,
      })),
      total,
    };
  }

  async createPost(
    userId: string,
    createPostDto: CreatePostDto,
  ): Promise<Post> {
    const postAssets = createPostDto.assetIds?.map((assetId, index) => {
      const asset = new PostAsset();
      asset.assetId = assetId;
      asset.displayOrder = index;
      return asset;
    });

    // Construction rules live in the entity factory (defaults status to draft).
    const post = Post.create({
      authorId: userId,
      content: createPostDto.content,
      assets: postAssets,
    });

    // Publishing is a domain transition; publish() throws InvalidPostStateError
    // (-> HTTP 400) when the content is empty (FR-007).
    if (createPostDto.publish) {
      post.publish();
    }

    const savedPost = await this.postRepository.save(post);
    this.logger.debug('Post created', { props: { postId: savedPost.id } });

    return savedPost;
  }

  async getPost(id: string): Promise<Post> {
    // author is joined via the repository's default relations.
    const retrievedPost = await this.postRepository.findOneByIdOrThrow(id);
    this.logger.debug('Post retrieved', {
      props: { postId: retrievedPost.id },
    });

    return retrievedPost;
  }

  /** A single post plus its engagement counters (and viewer like state). */
  async getPostDetail(
    id: string,
    viewerId?: string,
  ): Promise<PostWithEngagement> {
    const post = await this.getPost(id);
    const engagement = await this.attachEngagement([post], viewerId);
    return { post, engagement: engagement.get(post.id)! };
  }

  async updatePost(
    userId: string,
    id: string,
    updatePostDto: UpdatePostDto,
  ): Promise<Post> {
    const post = await this.getPost(id);

    if (post.authorId !== userId) {
      throw new UnauthorizedError('You are not allowed to update this post');
    }
    if (updatePostDto.content) {
      post.content = updatePostDto.content;
    }
    const updatedPost = await this.postRepository.save(post);
    this.logger.debug('Post updated', { props: { postId: updatedPost.id } });
    return updatedPost;
  }

  async softDeletePost(userId: string, id: string): Promise<void> {
    const post = await this.getPost(id);

    if (post.authorId !== userId) {
      throw new UnauthorizedError('You are not allowed to delete this post');
    }

    await this.postRepository.softDelete(post);
    this.logger.debug('Post soft-deleted', { props: { postId: post.id } });
  }

  async publishPost(userId: string, id: string): Promise<Post> {
    const post = await this.getPost(id);

    if (post.authorId !== userId) {
      throw new UnauthorizedError('You are not allowed to publish this post');
    }
    // publish() enforces the rule and throws InvalidPostStateError (-> HTTP 400).
    post.publish();
    const publishedPost = await this.postRepository.save(post);
    this.logger.debug('Post published', {
      props: { postId: publishedPost.id },
    });
    return publishedPost;
  }

  async archivePost(userId: string, id: string): Promise<Post> {
    const post = await this.getPost(id);

    if (post.authorId !== userId) {
      throw new UnauthorizedError('You are not allowed to archive this post');
    }

    post.archive();

    const archivedPost = await this.postRepository.save(post);
    this.logger.debug('Post archived', { props: { postId: archivedPost.id } });

    return archivedPost;
  }

  async searchPosts(
    keyword: string,
    page: number,
    limit: number,
  ): Promise<{ items: PostWithEngagement[]; total: number }> {
    const [posts, total] = await this.postRepository.searchPublishedPosts(
      keyword,
      page,
      limit,
    );
    const engagement = await this.attachEngagement(posts);

    this.logger.debug('Posts searched', {
      props: { keyword, count: posts.length, total },
    });

    return {
      items: posts.map((post) => ({
        post,
        engagement: engagement.get(post.id)!,
      })),
      total,
    };
  }

  /** The following feed author set: the viewer plus every account they follow. */
  private async resolveFollowingAuthorIds(userId: string): Promise<string[]> {
    const follows = await this.followRepository.findFollowing(userId);
    return [...new Set([userId, ...follows.map((f) => f.followingId)])];
  }

  /**
   * Compute engagement counters for a page of posts using batched aggregate
   * queries (one per source table) — never one query per post.
   */
  private async attachEngagement(
    posts: Post[],
    viewerId?: string,
  ): Promise<Map<string, PostEngagement>> {
    const ids = posts.map((post) => post.id);
    if (ids.length === 0) return new Map();

    const [likeCounts, commentCounts, repostCounts, likedIds] =
      await Promise.all([
        this.postLikeRepository.countByPostIds(ids),
        this.commentRepository.countByPostIds(ids),
        this.repostRepository.countByOriginalPostIds(ids),
        viewerId
          ? this.postLikeRepository.findLikedPostIds(viewerId, ids)
          : Promise.resolve(new Set<string>()),
      ]);

    return new Map(
      ids.map((id) => [
        id,
        {
          likeCount: likeCounts.get(id) ?? 0,
          commentCount: commentCounts.get(id) ?? 0,
          repostCount: repostCounts.get(id) ?? 0,
          likedByMe: likedIds.has(id),
        },
      ]),
    );
  }
}
