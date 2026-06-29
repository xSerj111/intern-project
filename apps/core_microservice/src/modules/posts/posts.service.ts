import { Injectable } from '@nestjs/common';
import { CreatePostDto, UpdatePostDto } from '@repo/shared';
import { Post } from './domain/entities/post.entity';
import { PostRepository } from './infrastructure/repository/post.repository';

@Injectable()
export class PostsService {
  constructor(private readonly postRepository: PostRepository) {}

  async createPost(createPostDto: CreatePostDto): Promise<Post> {
    // Construction rules live in the entity factory (defaults status to draft).
    const post = Post.create({
      authorId: createPostDto.authorId,
      content: createPostDto.content,
    });
    return this.postRepository.save(post);
  }

  async getPost(id: string): Promise<Post> {
    // author is joined via the repository's default relations.
    return this.postRepository.findOneByIdOrThrow(id);
  }

  async updatePost(id: string, updatePostDto: UpdatePostDto): Promise<Post> {
    const post = await this.getPost(id);
    if (updatePostDto.content) {
      post.content = updatePostDto.content;
    }
    return this.postRepository.save(post);
  }

  async softDeletePost(id: string): Promise<void> {
    const post = await this.getPost(id);
    await this.postRepository.softDelete(post);
  }

  async publishPost(id: string): Promise<Post> {
    const post = await this.getPost(id);
    // publish() enforces the rule and throws InvalidPostStateError (-> HTTP 400).
    post.publish();
    return this.postRepository.save(post);
  }
}
