import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './domain/entities/comment.entity';
import { CommentLike } from './domain/entities/comment-like.entity';
import { CommentRepository } from './infrastructure/repository/comment.repository';
import { LoggerModule } from '@repo/shared';
import { ProfilesModule } from '../profiles/profiles.module';
import { PostsModule } from '../posts/posts.module';
import { COMMENT_REPOSITORY } from './domain/interfaces/comment-repository.port';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, CommentLike]),
    LoggerModule.forFeature('CommentsService'),
    ProfilesModule,
    // POST_REPOSITORY: comments are only created on an existing post.
    PostsModule,
  ],
  controllers: [CommentsController],
  providers: [
    CommentsService,
    CommentRepository,
    { provide: COMMENT_REPOSITORY, useExisting: CommentRepository },
  ],
  exports: [COMMENT_REPOSITORY],
})
export class CommentsModule {}
