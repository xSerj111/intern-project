import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';

// Import all Core entities
import { UserProfile } from './entities/user-profile.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Follow } from './entities/follow.entity';
import { PostLike } from './entities/post-like.entity';
import { CommentLike } from './entities/comment-like.entity';
import { Asset } from './entities/asset.entity';
import { PostAsset } from './entities/post-asset.entity';
import { ProfileToProfileConfiguration } from './entities/profile-to-profile-configuration.entity';
import { Chat } from './entities/chat.entity';
import { ChatParticipant } from './entities/chat-participant.entity';
import { Message } from './entities/message.entity';
import { MessageAsset } from './entities/message-asset.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '../../.env'),
      ],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get<string>('POSTGRES_USER', 'postgres'),
        password: config.get<string>('POSTGRES_PASSWORD', 'postgres'),
        
        // Target the Core database
        database: config.get<string>('DB_NAME_CORE', 'innogram_core'),
        
        entities: [UserProfile, Post, Comment, Follow, PostLike, CommentLike, Asset, PostAsset, ProfileToProfileConfiguration, Chat, ChatParticipant, Message, MessageAsset],
        synchronize: false, // Strict migrations mode
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}