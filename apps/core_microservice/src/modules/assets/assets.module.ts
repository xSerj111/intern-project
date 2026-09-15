import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './domain/entities/asset.entity';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { LoggerModule } from '@repo/shared';
import { AssetRepository } from './infrastructure/repository/asset.repository';
import { FileStoragePortKey } from './domain/interfaces/file-storage.port';
import { S3StorageAdapter } from './infrastructure/storage/s3-storage.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset]),
    LoggerModule.forFeature('AssetsService'),
  ],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    AssetRepository,
    {
      provide: FileStoragePortKey,
      useClass: S3StorageAdapter,
    },
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
