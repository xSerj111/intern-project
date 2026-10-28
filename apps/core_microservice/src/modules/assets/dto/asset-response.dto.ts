import { ApiProperty } from '@nestjs/swagger';
import type { IUploadTicket } from '@repo/contracts';
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

export class UploadTicketDto implements IUploadTicket {
  @ApiProperty({ description: 'Equals the asset id' }) uploadId!: string;
  @ApiProperty({ description: 'Storage POST endpoint' }) url!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Send verbatim in the multipart form, before the file',
  })
  fields!: Record<string, string>;
  @ApiProperty() maxBytes!: number;
  @ApiProperty({ description: 'ISO timestamp' }) expiresAt!: string;
}
