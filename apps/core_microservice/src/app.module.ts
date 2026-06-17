import * as dotenv from 'dotenv';
import * as path from 'path';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '@repo/shared';
import { ConfigModule } from '@nestjs/config'


dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT!, 10),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,

      entities: [User],
      synchronize: false,

    }),
    
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
console.log('DB ENV:', {
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  db: process.env.POSTGRES_DB,
});