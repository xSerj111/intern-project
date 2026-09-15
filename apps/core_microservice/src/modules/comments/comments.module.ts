import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './domain/entities/comment.entity';
import { CommentLike } from './domain/entities/comment-like.entity';
import { CommentRepository } from './infrastructure/repository/comment.repository';
import { LoggerModule } from '@repo/shared';
import { PostsModule } from '../posts/posts.module';
import { PostVerificationPortKey } from './domain/interfaces/post-verification.port';
import { PostsService } from '../posts/posts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, CommentLike]),
    LoggerModule.forFeature('CommentsService'),
    PostsModule,
  ],
  controllers: [CommentsController],
  providers: [
    CommentsService,
    CommentRepository,
    {
      provide: PostVerificationPortKey,
      useFactory: (postsService: PostsService) => ({
        verifyPostAccess: async (userId: string, postId: string) => {
          await postsService.getPost(userId, postId);
        },
      }),
      inject: [PostsService],
    },
  ],
})
export class CommentsModule {}
