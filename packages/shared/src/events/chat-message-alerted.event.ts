import { Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { ActorSnapshot } from "./event-envelope";

export const MESSAGE_PREVIEW_MAX_LENGTH = 100;

/** Email only, never stored (FR-034). */
export class ChatMessageAlertedPayload {
  @ValidateNested()
  @Type(() => ActorSnapshot)
  public actor!: ActorSnapshot;

  @IsUUID()
  public recipientId!: string;

  @IsUUID()
  public chatId!: string;

  @IsUUID()
  public messageId!: string;

  @IsOptional()
  @IsString()
  public chatTitle!: string | null;

  @IsString()
  @MaxLength(MESSAGE_PREVIEW_MAX_LENGTH)
  public preview!: string;
}
