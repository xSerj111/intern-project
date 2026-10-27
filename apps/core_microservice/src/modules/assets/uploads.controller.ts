import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { IUploadTicket } from '@repo/contracts';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadedAttachmentDto } from '../chats/dto/message-response.dto';
import { AssetResponseDto, UploadTicketDto } from './dto/asset-response.dto';
import { CreateUploadDto } from './dto/create-upload.dto';
import { UploadsService, type ConfirmedUpload } from './uploads.service';

@ApiTags('Uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a signed direct-to-storage upload' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Upload ticket: storage URL and signed form fields',
    type: UploadTicketDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Unknown purpose, size out of range or type not allowed',
  })
  createUpload(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateUploadDto,
  ): Promise<IUploadTicket> {
    return this.uploadsService.createUpload(userId, dto);
  }

  @Post(':uploadId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an uploaded object (idempotent)' })
  @ApiExtraModels(AssetResponseDto, UploadedAttachmentDto)
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'IAssetResponse for post-image/avatar, IUploadedAttachment for chat-attachment',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AssetResponseDto) },
        { $ref: getSchemaPath(UploadedAttachmentDto) },
      ],
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Expired, not uploaded, too large or content not allowed',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Unknown upload, or not the caller’s',
  })
  confirm(
    @CurrentUser('sub') userId: string,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<ConfirmedUpload> {
    return this.uploadsService.confirm(userId, uploadId);
  }
}
