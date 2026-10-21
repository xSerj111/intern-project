import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './domain/entities/asset.entity';
import { AssetsService } from './assets.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { LoggerModule } from '@repo/shared';
import { AssetRepository } from './infrastructure/repository/asset.repository';
import { UploadRepository } from './infrastructure/repository/upload.repository';
import { PendingUploadSweeper } from './infrastructure/pending-upload.sweeper';
import { FileTypeContentSniffer } from './infrastructure/content/file-type-content-sniffer';
import { FileStoragePortKey } from './domain/interfaces/file-storage.port';
import { UPLOAD_REPOSITORY } from './domain/interfaces/upload-repository.port';
import { CONTENT_SNIFFER } from './domain/interfaces/content-sniffer.port';
import { S3StorageAdapter } from './infrastructure/storage/s3-storage.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset]),
    LoggerModule.forFeature('AssetsService'),
  ],
  controllers: [UploadsController],
  providers: [
    AssetsService,
    UploadsService,
    PendingUploadSweeper,
    AssetRepository,
    { provide: UPLOAD_REPOSITORY, useClass: UploadRepository },
    { provide: CONTENT_SNIFFER, useClass: FileTypeContentSniffer },
    {
      provide: FileStoragePortKey,
      useClass: S3StorageAdapter,
    },
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
