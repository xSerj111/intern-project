import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateCommentDto, UpdateCommentDto } from '@repo/shared';
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
      parentId: createCommentDto.parentId,
      content: createCommentDto.content,
    });
    return this.commentRepository.save(newComment);
  }

  async updateComment(id: string, updateCommentDto: UpdateCommentDto): Promise<Comment> {
    const comment = await this.commentRepository.findOne({ where: { id } });
    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`)
    }

    if (updateCommentDto.content) {
      comment.content = updateCommentDto.content;
    }

    return this.commentRepository.save(comment);
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
