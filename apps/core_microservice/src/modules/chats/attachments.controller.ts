import {
  Controller,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import 'multer';
import { ATTACHMENT_MAX_BYTES } from '@repo/contracts';
import { MessagesService } from './messages.service';
import {
  AttachmentUrlDto,
  UploadedAttachmentDto,
} from './dto/message-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Single source of truth in @repo/contracts; re-exported for the spec.
export { ATTACHMENT_MAX_BYTES };

/**
 * Allowed attachment types (FR-025). Anchored, so a parameter or suffix
 * (`text/plain; x`, `image/png-evil`) never matches.
 */
export const ATTACHMENT_MIME_TYPES =
  /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|application\/pdf|text\/(plain|csv)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$/;

/**
 * Size + type validation. Binary types are identified by magic number and the
 * detected type replaces the declared one (`overrideMimeType`); text types,
 * which have none, fall back to the declared MIME type. The error names the
 * type that was checked.
 */
export function attachmentFilePipe(): ParseFilePipe {
  return new ParseFilePipe({
    validators: [
      new MaxFileSizeValidator({ maxSize: ATTACHMENT_MAX_BYTES }),
      new FileTypeValidator({
        fileType: ATTACHMENT_MIME_TYPES,
        fallbackToMimetype: true,
        overrideMimeType: true,
        errorMessage: ({ file }) =>
          `File type ${file?.mimetype || 'unknown'} not allowed`,
      }),
    ],
  });
}

@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class AttachmentsController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('attachments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload a private chat attachment' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Attachment stored; returns the asset reference',
    type: UploadedAttachmentDto,
  })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'File exceeds the 10 MB limit',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'File type not allowed',
  })
  @UseInterceptors(
    // Multer stops reading past the limit (413) instead of buffering it all.
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  upload(
    @CurrentUser('sub') userId: string,
    @UploadedFile(attachmentFilePipe()) file: Express.Multer.File,
  ): Promise<UploadedAttachmentDto> {
    return this.messagesService.uploadAttachment(userId, file);
  }

  @Get(':chatId/messages/:messageId/attachments/:assetId')
  @ApiOperation({ summary: 'Fresh presigned URL for a message attachment' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Short-lived presigned download URL',
    type: AttachmentUrlDto,
  })
  url(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<AttachmentUrlDto> {
    return this.messagesService.attachmentUrl(
      userId,
      chatId,
      messageId,
      assetId,
    );
  }
}
