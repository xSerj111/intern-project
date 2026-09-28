import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './domain/entities/comment.entity';
import { CommentLike } from './domain/entities/comment-like.entity';
import { CommentRepository } from './infrastructure/repository/comment.repository';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, CommentLike]),
    LoggerModule.forFeature('CommentsService'),
  ],
  controllers: [CommentsController],
  providers: [CommentsService, CommentRepository],
  exports: [CommentRepository],
})
export class CommentsModule {}
