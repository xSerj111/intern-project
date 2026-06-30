import { Inject, Injectable } from '@nestjs/common';
import { CreatePostDto, type Logger, LoggerKey, UpdatePostDto } from '@repo/shared';
import { Post } from './domain/entities/post.entity';
import { PostRepository } from './infrastructure/repository/post.repository';

@Injectable()
export class PostsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    private readonly postRepository: PostRepository
  ) {}

  async createPost(createPostDto: CreatePostDto): Promise<Post> {
    // Construction rules live in the entity factory (defaults status to draft).
    const post = Post.create({
      authorId: createPostDto.authorId,
      content: createPostDto.content,
    });

    const savedPost = await this.postRepository.save(post);
    this.logger.debug('Post created', { props: { postId: savedPost.id } });

    return savedPost;
  }

  async getPost(id: string): Promise<Post> {
    // author is joined via the repository's default relations.
    const retrievedPost = await this.postRepository.findOneByIdOrThrow(id);
    this.logger.debug('Post retrieved', { props: { postId: retrievedPost.id } });

    return retrievedPost;
  }

  async updatePost(id: string, updatePostDto: UpdatePostDto): Promise<Post> {
    const post = await this.getPost(id);
    if (updatePostDto.content) {
      post.content = updatePostDto.content;
    }
    const updatedPost = await this.postRepository.save(post);
    this.logger.debug('Post updated', { props: { postId: updatedPost.id } });
    return updatedPost;
  }

  async softDeletePost(id: string): Promise<void> {
    const post = await this.getPost(id);
    await this.postRepository.softDelete(post);
    this.logger.debug('Post soft-deleted', { props: { postId: post.id } });
  }

  async publishPost(id: string): Promise<Post> {
    const post = await this.getPost(id);
    // publish() enforces the rule and throws InvalidPostStateError (-> HTTP 400).
    post.publish();
    const publishedPost = await this.postRepository.save(post);
    this.logger.debug('Post published', { props: { postId: publishedPost.id } });
    return publishedPost;
  }
}
