import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateCommentDto } from '@repo/shared';
import { Comment } from 'src/entities/comment.entity';
import { Repository } from 'typeorm';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
  ) {}

  async createComment(createCommentDto: CreateCommentDto): Promise<Comment> {
    const newComment = this.commentRepository.create({
      authorId: createCommentDto.authorId,
      postId: createCommentDto.postId,
      content: createCommentDto.content,
    });
    return this.commentRepository.save(newComment);
  }

  // We return an array of comments here
  async getCommentsByPost(postId: string): Promise<Comment[]> {
    return this.commentRepository.find({
      where: { postId },
      relations: {
        author: true, // we want to show commenters handle in the ui
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async softDeleteComment(id: string): Promise<void> {
    const result = await this.commentRepository.softDelete(id);
    if(result.affected === 0) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }
  }
  
}
