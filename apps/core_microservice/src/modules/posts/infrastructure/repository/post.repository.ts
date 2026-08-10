import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, ILike } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Post, PostStatus } from '../../domain/entities/post.entity';
import type { PostProps } from '../../domain/interfaces/post.props';

@Injectable()
export class PostRepository extends TypeormRepositoryBase<Post, PostProps> {
  public static readonly entity = Post;
  // Joined by default so reads include the post's author profile.
  protected relations: string[] = ['author', 'assets'];

  constructor(
    @InjectRepository(Post)
    repository: Repository<Post>,
  ) {
    super(repository);
  }

  async getFeedForAuthors(
    authorIds: string[],
    page: number,
    limit: number,
  ): Promise<[Post[], number]> {
    const skip = (page - 1) * limit;

    return this.repository.findAndCount({
      where: {
        authorId: In(authorIds),
        status: PostStatus.Published,
      },
      relations: { author: true, assets: true },
      order: {
        createdAt: 'DESC',
      },
      skip,
      take: limit,
    });
  }

  async searchPublishedPosts(
    keyword: string,
    page: number,
    limit: number,
  ): Promise<[Post[], number]> {
    const skip = (page - 1) * limit;

    return this.repository.findAndCount({
      where: {
        content: ILike(`%${keyword}%`),
        status: PostStatus.Published,
        authorIsPrivate: false,
      },
      relations: { author: true, assets: true },
      order: {
        createdAt: 'DESC',
      },
      skip,
      take: limit,
    });
  }
}
