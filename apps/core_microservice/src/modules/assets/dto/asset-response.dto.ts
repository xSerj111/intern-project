import { ApiProperty } from '@nestjs/swagger';
import { Asset } from '../domain/entities/asset.entity';
import { AssetProps } from '../domain/interfaces/asset-props';

export class AssetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) url!: string | null;
  @ApiProperty() mimeType!: string;
  @ApiProperty() size!: number;
  @ApiProperty() createdAt!: string;

  constructor(props: AssetProps) {
    this.id = props.id;
    this.url = props.url;
    this.mimeType = props.mimeType;
    this.size = props.size;
    this.createdAt = props.createdAt.toISOString();
  }
}
