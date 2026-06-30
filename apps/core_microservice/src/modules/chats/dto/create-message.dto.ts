import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";
import { ICreateMessageRequest } from "@repo/contracts";

export class CreateMessageDto implements ICreateMessageRequest {
  @ApiProperty({ description: 'Chat ID, where the message is sent to' })
  @IsUUID()
  chatId!: string;

  @ApiProperty({ description: 'Message content' })
  @IsString({ message: 'Content must be a text '})
  @IsNotEmpty({ message: 'Message cannot be empty' })
  @MaxLength(2000, { message: 'Message is too long (max 2000 chars)' })
  content!: string;
}