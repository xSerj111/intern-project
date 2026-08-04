import { ApiProperty } from '@nestjs/swagger';
import { Asset } from '../domain/entities/asset.entity';

export class AssetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() size!: number;
  @ApiProperty() createdAt!: string;

  constructor(asset: Asset) {
    this.id = asset.id;
    this.url = asset.url;
    this.mimeType = asset.mimeType;
    this.size = asset.size;
    this.createdAt = asset.createdAt.toISOString();
  }
}
