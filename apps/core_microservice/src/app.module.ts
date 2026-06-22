import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Comment } from './entities/comment.entity';
import { UserProfile } from './entities/user-profile.entity';
import { Follow } from './entities/follow.entity';
import { Post } from './entities/post.entity';
import { Like } from './entities/like.entity';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST'),
        port: parseInt(config.get<string>('POSTGRES_PORT') || '5432', 10),
        username: config.get<string>('POSTGRES_USER'),
        password: config.get<string>('POSTGRES_PASSWORD'),
        database: config.get<string>('POSTGRES_DB'),

        entities: [Comment, UserProfile, Follow, Post, Like],
        synchronize: false,

      }),
    }),
    
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
