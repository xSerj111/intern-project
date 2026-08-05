import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { type Logger, LoggerKey } from '@repo/shared';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post } from './domain/entities/post.entity';
import { PostRepository } from './infrastructure/repository/post.repository';
import { PostAsset } from './domain/entities/post-asset.entity';
import type { IFollowRepository } from '../follows/domain/interfaces/follow-repository.port';
import { InjectRepository } from '@nestjs/typeorm';
import { PostLike } from './domain/entities/post-like.entity';
import { Repository } from 'typeorm';

@Injectable()
export class PostsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly postRepository: PostRepository,
    @Inject(Symbol.for('IFollowRepository'))
    private readonly followRepository: IFollowRepository,
    @InjectRepository(PostLike)
    private readonly postLikeRepository: Repository<PostLike>,
  ) {}

  async toggleLike(userId: string, postId: string): Promise<void> {
    await this.getPost(postId);

    const existingLike = await this.postLikeRepository.findOne({
      where: { userId, postId },
      withDeleted: true,
    });

    if (existingLike) {
      if (existingLike.deletedAt) {
        await this.postLikeRepository.restore(existingLike.id);
        this.logger.debug('Post like restored', { props: { postId, userId } });
      } else {
        await this.postLikeRepository.softRemove(existingLike);
        this.logger.debug('Post like soft-removed', {
          props: { postId, userId },
        });
      }
    } else {
      const newLike = this.postLikeRepository.create({ userId, postId });
      await this.postLikeRepository.save(newLike);
      this.logger.debug('Post liked', { props: { postId, userId } });
    }
  }
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
}
