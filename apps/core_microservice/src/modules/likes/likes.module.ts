import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from '@repo/shared';

import { CommentsModule } from '../comments/comments.module';
import { CommentLike } from '../comments/domain/entities/comment-like.entity';
import { PostsModule } from '../posts/posts.module';
import { PostLike } from '../posts/domain/entities/post-like.entity';
import { ProfilesModule } from '../profiles/profiles.module';
import { COMMENT_LIKE_REPOSITORY } from './domain/interfaces/comment-like-repository.port';
import { POST_LIKE_REPOSITORY } from './domain/interfaces/post-like-repository.port';
import { CommentLikeRepository } from './infrastructure/repository/comment-like.repository';
import { PostLikeRepository } from './infrastructure/repository/post-like.repository';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

// OUTBOX_PORT comes from the global MessagingModule; POST_REPOSITORY and
// COMMENT_REPOSITORY are exported by the posts and comments modules.
@Module({
  imports: [
    TypeOrmModule.forFeature([PostLike, CommentLike]),
    LoggerModule.forFeature('LikesService'),
    ProfilesModule,
    PostsModule,
    CommentsModule,
  ],
  controllers: [LikesController],
  providers: [
    LikesService,
    { provide: POST_LIKE_REPOSITORY, useClass: PostLikeRepository },
    { provide: COMMENT_LIKE_REPOSITORY, useClass: CommentLikeRepository },
  ],
})
export class LikesModule {}
