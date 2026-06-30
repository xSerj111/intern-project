import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './domain/entities/post.entity';
import { PostLike } from './domain/entities/post-like.entity';
import { PostAsset } from './domain/entities/post-asset.entity';
import { PostRepository } from './infrastructure/repository/post.repository';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostLike, PostAsset]), 
    LoggerModule.forFeature('PostsService'),
  ],
  controllers: [PostsController],
  providers: [PostsService, PostRepository],
})
export class PostsModule {}
