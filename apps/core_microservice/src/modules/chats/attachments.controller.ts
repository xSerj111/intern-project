import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { AttachmentUrlDto } from './dto/message-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class AttachmentsController {
  constructor(private readonly messagesService: MessagesService) {}

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
