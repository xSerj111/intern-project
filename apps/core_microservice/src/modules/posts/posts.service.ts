import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { EntityByIdNotFoundError, type Logger, LoggerKey } from '@repo/shared';
import { AssetsService } from '../assets/assets.service';
import { ProfileSummaryCache } from '../../common/cache/profile-summary-cache';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post, PostStatus } from './domain/entities/post.entity';
import {
  POST_REPOSITORY,
  type IPostRepository,
  type LikeStats,
} from './domain/interfaces/post-repository.port';
import { PostAsset } from './domain/entities/post-asset.entity';
import { FeedCursor } from './domain/feed-cursor';

@Injectable()
export class PostsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(POST_REPOSITORY)
    private readonly postRepository: IPostRepository,
    private readonly profileCache: ProfileSummaryCache,
    private readonly assets: AssetsService,
  ) {}

  /**
   * One keyset page of the viewer's feed (own posts and followed authors).
   * `cursor` was already validated by the DTO; omit it for the first page.
   */
  async getFeed(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: Post[]; nextCursor: string | null }> {
    const { posts, nextCursor } = await this.postRepository.findFeedPage(
      userId,
      cursor === undefined ? null : FeedCursor.decode(cursor),
      limit,
    );

    this.logger.debug('Feed retrieved', {
      props: { userId, count: posts.length, hasMore: nextCursor !== null },
    });

    return { items: posts, nextCursor };
  }

  /** Hashtags starting with `q` (already normalized by the DTO), most used first. */
  async searchHashtags(
    q: string,
    limit: number,
  ): Promise<{ tag: string; postCount: number }[]> {
    const results = await this.postRepository.searchHashtags(q, limit);

    this.logger.debug('Hashtags searched', {
      props: { q, count: results.length },
    });

    return results;
  }

  /**
   * One keyset page of published posts carrying `tag` (already normalized),
   * newest first. `cursor` was already validated by the DTO; omit it for the
   * first page.
   */
  async getHashtagFeed(
    tag: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: Post[]; nextCursor: string | null }> {
    const { posts, nextCursor } = await this.postRepository.findByHashtagPage(
      tag,
      cursor === undefined ? null : FeedCursor.decode(cursor),
      limit,
    );

    this.logger.debug('Hashtag feed retrieved', {
      props: { tag, count: posts.length, hasMore: nextCursor !== null },
    });

    return { items: posts, nextCursor };
  }

  /**
   * One author's posts in `status`, newest first. Published posts are public;
   * any other status is only listed for the author themself.
   * @throws PostStatusNotVisibleError (403) when `viewerId` is not the author
   */
  async getPostsByAuthor(
    authorId: string,
    status: PostStatus,
    page: number,
    limit: number,
    viewerId?: string,
  ): Promise<{ items: Post[]; total: number }> {
    Post.assertStatusListableBy(authorId, status, viewerId);

    const [items, total] = await this.postRepository.findByAuthor(
      authorId,
      status,
      page,
      limit,
    );

    this.logger.debug('Posts by author retrieved', {
      props: { authorId, status, count: items.length, total },
    });

    return { items, total };
  }

  async createPost(
    userId: string,
    createPostDto: CreatePostDto,
  ): Promise<Post> {
    await this.assertAssetsAttachable(userId, createPostDto.assetIds);

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

    // Reload so the response carries the joined author and the assets' files.
    return this.postRepository.findOneByIdOrThrow(savedPost.id);
  }

  /**
   * Every asset must be a confirmed (READY) upload of the caller that fits a
   * post. Missing, unconfirmed and foreign ids all read as 404 so other
   * users' ids can't be probed.
   * @throws EntityByIdNotFoundError (404), AssetNotAttachableError (400)
   */
  private async assertAssetsAttachable(
    userId: string,
    assetIds: string[] | undefined,
  ): Promise<void> {
    if (!assetIds?.length) return;
    const found = new Map(
      (await this.assets.findByIds(assetIds)).map((a) => [a.id, a]),
    );
    for (const assetId of assetIds) {
      const asset = found.get(assetId);
      if (!asset || !asset.isOwnedBy(userId)) {
        throw new EntityByIdNotFoundError('assets', assetId);
      }
      asset.assertAttachableTo('post', userId);
    }
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
      post.editContent(updatePostDto.content);
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
    await this.profileCache.invalidateCounts(post.authorId);
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
    await this.profileCache.invalidateCounts(publishedPost.authorId);
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
    await this.profileCache.invalidateCounts(archivedPost.authorId);
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

  /** Active comment count per post (one grouped query). */
  async getCommentCounts(postIds: string[]): Promise<Map<string, number>> {
    return this.postRepository.getCommentCounts(postIds);
  }
}
