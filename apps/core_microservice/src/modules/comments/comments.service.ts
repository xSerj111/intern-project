import { Injectable } from '@nestjs/common';
import { CreateCommentDto, UpdateCommentDto } from '@repo/shared';
import { Comment } from './domain/entities/comment.entity';
import { CommentRepository } from './infrastructure/repository/comment.repository';

@Injectable()
export class CommentsService {
  constructor(private readonly commentRepository: CommentRepository) {}

  async createComment(createCommentDto: CreateCommentDto): Promise<Comment> {
    const comment = Comment.create({
      authorId: createCommentDto.authorId,
      postId: createCommentDto.postId,
      parentId: createCommentDto.parentId,
      content: createCommentDto.content,
    });
    return this.commentRepository.save(comment);
  }

  async updateComment(
    id: string,
    updateCommentDto: UpdateCommentDto,
  ): Promise<Comment> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);
    if (updateCommentDto.content !== undefined) {
      comment.edit(updateCommentDto.content);
    }
    return this.commentRepository.save(comment);
  }

  // We return an array of comments here (newest first, with author joined)
  async getCommentsByPost(postId: string): Promise<Comment[]> {
    return this.commentRepository.findByPost(postId);
  }

  async softDeleteComment(id: string): Promise<void> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);
    await this.commentRepository.softDelete(comment);
  }
}
