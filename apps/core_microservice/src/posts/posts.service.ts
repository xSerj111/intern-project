import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreatePostDto } from '@repo/shared';
import { Post } from 'src/entities/post.entity';
import { Repository } from 'typeorm';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
  ) {}

  async createPost(createPostDto: CreatePostDto): Promise<Post> {
    // Because we set up the Foreign Key in the entity, TypeORM knows 
    // exactly how to link this authorId to the UserProfile table!
    const newPost = this.postRepository.create({
      authorId: createPostDto.authorId,
      content: createPostDto.content,
    });
    return this.postRepository.save(newPost);
  }

  async getPost(id: string): Promise<Post> {
    // We use relations: ['author'] so the database automatically joins 
    // the UserProfile data (like their handle) to the response!
    const post = await this.postRepository.findOne({
      where: { id },
      relations: {
        author: true,
      },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }
    return post;
  }

  async softDeletePost(id: string): Promise<void> {
    // Instead of permanently destroying the row, softDelete populates 
    // the deletedAt column. It will automatically be hidden from future queries!
    const result = await this.postRepository.softDelete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }
  }
  
}
