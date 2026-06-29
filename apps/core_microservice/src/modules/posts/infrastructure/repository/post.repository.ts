import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Post } from '../../domain/entities/post.entity';
import type { PostProps } from '../../domain/interfaces/post.props';

@Injectable()
export class PostRepository extends TypeormRepositoryBase<Post, PostProps> {

  public static readonly entity = Post;
  // Joined by default so reads include the post's author profile.
  protected relations: string[] = ['author'];

  constructor(
    @InjectRepository(Post)
    repository: Repository<Post>,
  ) {
    super(repository);
  }
}
