import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from '@repo/shared';

import { Comment } from '../comments/domain/entities/comment.entity';
import { CommentLike } from '../comments/domain/entities/comment-like.entity';
import { CommentRepository } from '../comments/infrastructure/repository/comment.repository';
import { Post } from '../posts/domain/entities/post.entity';
import { PostLike } from '../posts/domain/entities/post-like.entity';
import { PostAsset } from '../posts/domain/entities/post-asset.entity';
import { PostRepository } from '../posts/infrastructure/repository/post.repository';
import { ProfilesModule } from '../profiles/profiles.module';
import { COMMENT_LIKE_REPOSITORY } from './domain/interfaces/comment-like-repository.port';
import { POST_LIKE_REPOSITORY } from './domain/interfaces/post-like-repository.port';
import { CommentLikeRepository } from './infrastructure/repository/comment-like.repository';
import { PostLikeRepository } from './infrastructure/repository/post-like.repository';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

// OUTBOX_PORT comes from the global MessagingModule.
@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostAsset, PostLike, Comment, CommentLike]),
    LoggerModule.forFeature('LikesService'),
    ProfilesModule,
  ],
  controllers: [LikesController],
  providers: [
    LikesService,
    // Own instances of the finders: avoids editing the posts/comments modules.
    PostRepository,
    CommentRepository,
    { provide: POST_LIKE_REPOSITORY, useClass: PostLikeRepository },
    { provide: COMMENT_LIKE_REPOSITORY, useClass: CommentLikeRepository },
  ],
})
export class LikesModule {}
