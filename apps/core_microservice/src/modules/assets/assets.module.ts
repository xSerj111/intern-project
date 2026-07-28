import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './domain/entities/asset.entity';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset]),
    LoggerModule.forFeature('AssetsService'),
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
