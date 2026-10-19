import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { type Logger, LoggerKey } from '@repo/shared';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post } from './domain/entities/post.entity';
import {
  POST_REPOSITORY,
  type IPostRepository,
  type LikeStats,
} from './domain/interfaces/post-repository.port';
import { PostAsset } from './domain/entities/post-asset.entity';
import { FollowRepositoryKey } from '../follows/domain/interfaces/follow-repository.port';
import type { IFollowRepository } from '../follows/domain/interfaces/follow-repository.port';

@Injectable()
export class PostsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(POST_REPOSITORY)
    private readonly postRepository: IPostRepository,
    @Inject(FollowRepositoryKey)
    private readonly followRepository: IFollowRepository,
  ) {}

  async getFeed(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: Post[]; total: number }> {
    const follows = await this.followRepository.findFollowing(userId);
    const followingIds = follows.map((f) => f.followingId);

    const targetAuthorIds = [...followingIds, userId];

    const [items, total] = await this.postRepository.getFeedForAuthors(
      targetAuthorIds,
      page,
      limit,
    );

    this.logger.debug('Feed retrieved', {
      props: { userId, count: items.length, total },
    });

    return { items, total };
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

  async updatePost(
    userId: string,
    id: string,
    updatePostDto: UpdatePostDto,
  ): Promise<Post> {
    const post = await this.getPost(id);

    if (post.authorId !== userId) {
      throw new ForbiddenException('You are not allowed to update this post');
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
      throw new ForbiddenException('You are not allowed to delete this post');
    }

    await this.postRepository.softDelete(post);
    this.logger.debug('Post soft-deleted', { props: { postId: post.id } });
  }

  async publishPost(userId: string, id: string): Promise<Post> {
    const post = await this.getPost(id);

    if (post.authorId !== userId) {
      throw new ForbiddenException('You are not allowed to publish this post');
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
      throw new ForbiddenException('You are not allowed to archive this post');
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
  ): Promise<{ items: Post[]; total: number }> {
    const [items, total] = await this.postRepository.searchPublishedPosts(
      keyword,
      page,
      limit,
    );

    this.logger.debug('Posts searched', {
      props: { keyword, count: items.length, total },
    });

    return { items, total };
  }

  /** Like count and the viewer's own like per post (one query); viewer optional. */
  async getLikeStats(
    postIds: string[],
    viewerId?: string,
  ): Promise<Map<string, LikeStats>> {
    return this.postRepository.getLikeStats(postIds, viewerId);
  }
}
