import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';
import 'multer';
import {
  FileStoragePortKey,
  type IFileStoragePort,
} from './domain/interfaces/file-storage.port';
import { AssetRepository } from './infrastructure/repository/asset.repository';
import { Asset } from './domain/entities/asset.entity';

@Injectable()
export class AssetsService {
  constructor(
    @Inject(FileStoragePortKey) private readonly fileStorage: IFileStoragePort,
    private readonly assetRepository: AssetRepository,
    @Inject(LoggerKey) private readonly logger: Logger,
  ) {}

  async uploadAsset(
    uploaderId: string,
    file: Express.Multer.File,
  ): Promise<Asset> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const url = await this.fileStorage.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    const asset = Asset.create({
      uploaderId,
      url,
      mimeType: file.mimetype,
      size: file.size,
    });

    const savedAsset = await this.assetRepository.save(asset);

    this.logger.info('Asset uploaded successfully', {
      props: { assetId: savedAsset.id, uploaderId },
    });

    return savedAsset;
  }
}
