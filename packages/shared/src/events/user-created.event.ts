import { Type } from "class-transformer";
import { IsDate, IsEmail, IsString, IsUUID, Length } from "class-validator";

export class UserCreatedEvent {
  // Decorators are required, not cosmetic: consumers run a global
  // ValidationPipe with `whitelist: true`, which strips every property
  // that carries no class-validator metadata.
  @IsUUID()
  public readonly authUserId!: string;

  @IsEmail()
  public readonly email!: string;

  @IsString()
  @Length(3, 30)
  public readonly handle!: string;

  @Type(() => Date)
  @IsDate()
  public readonly timestamp!: Date;

  constructor(
    authUserId?: string,
    email?: string,
    handle?: string,
    timestamp?: Date,
  ) {
    // Params are optional so class-transformer can instantiate from a plain
    // JSON body (it constructs with no arguments, then assigns properties).
    this.authUserId = authUserId!;
    this.email = email!;
    this.handle = handle!;
    this.timestamp = timestamp!;
  }
}
