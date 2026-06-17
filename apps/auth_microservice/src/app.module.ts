import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthUser } from './entities/auth-user.entity';
import { AuthSession } from './entities/auth-session.entity';
import * as path from 'path';

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
      useFactory: (config: ConfigService) => {
        const dbConnection = {
          host: config.get('POSTGRES_HOST'),
          port: config.get('POSTGRES_PORT'),
          user: config.get('POSTGRES_USER'),
          password: config.get('POSTGRES_PASSWORD'),
          db: config.get('POSTGRES_DB'),
        };

        console.log('CONFIG dbConnection:', dbConnection);

        return {
          type: 'postgres',
          host: dbConnection.host,
          port: parseInt(dbConnection.port || '5432', 10),
          username: dbConnection.user,
          password: dbConnection.password,
          database: dbConnection.db,
          entities: [AuthUser, AuthSession],
          synchronize: false,
        };
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}