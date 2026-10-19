import { Type } from "class-transformer";
import { IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";
import { ActorSnapshot } from "./event-envelope";

// Decorators are required: consumers validate with `whitelist: true`, which
// strips every property that carries no class-validator metadata.

export const EXCERPT_MAX_LENGTH = 140;

export class PostCommentedPayload {
  @ValidateNested()
  @Type(() => ActorSnapshot)
  public actor!: ActorSnapshot;

  /** post author */
  @IsUUID()
  public recipientId!: string;

  @IsUUID()
  public postId!: string;

  @IsUUID()
  public commentId!: string;

  @IsString()
  @MaxLength(EXCERPT_MAX_LENGTH)
  public excerpt!: string;
}

export class PostLikedPayload {
  @ValidateNested()
  @Type(() => ActorSnapshot)
  public actor!: ActorSnapshot;

  @IsUUID()
  public recipientId!: string;

  @IsUUID()
  public postId!: string;

  @IsString()
  @MaxLength(EXCERPT_MAX_LENGTH)
  public excerpt!: string;
}

export class CommentLikedPayload {
  @ValidateNested()
  @Type(() => ActorSnapshot)
  public actor!: ActorSnapshot;

  /** comment author */
  @IsUUID()
  public recipientId!: string;

  @IsUUID()
  public postId!: string;

  @IsUUID()
  public commentId!: string;

  @IsString()
  @MaxLength(EXCERPT_MAX_LENGTH)
  public excerpt!: string;
}

export class UserFollowedPayload {
  @ValidateNested()
  @Type(() => ActorSnapshot)
  public actor!: ActorSnapshot;

  /** followed user */
  @IsUUID()
  public recipientId!: string;
}
