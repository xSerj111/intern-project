import { IsISO8601, IsOptional, IsString, IsUUID } from "class-validator";

export class SessionRevokedEvent {
  // Decorators are required: ValidationPipe `whitelist: true` strips
  // properties without class-validator metadata.
  @IsUUID()
  public readonly userId!: string;

  @IsOptional()
  @IsString()
  public readonly sid!: string | null;

  @IsOptional()
  @IsString()
  public readonly jti!: string | null;

  @IsISO8601()
  public readonly revokedAt!: string;

  constructor(
    userId?: string,
    sid?: string | null,
    jti?: string | null,
    revokedAt?: string,
  ) {
    this.userId = userId!;
    this.sid = sid ?? null;
    this.jti = jti ?? null;
    this.revokedAt = revokedAt!;
  }
}
