export interface JwtPayload {
  sub: string; // User identifier (User ID)
  email: string;
  jti?: string; // Unique token ID, used as the blacklist key
  sid?: string; // Session id, stable across refresh rotation
  iat?: number;
  exp?: number; // Unix seconds
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // refresh_token_id, keys the Redis session
  sid?: string; // Session id, stable across refresh rotation
  exp: number; // Unix seconds
}

export interface IJwtService {
  signAccessToken(payload: JwtPayload): string;
  verifyAccessToken(token: string): JwtPayload;
  signRefreshToken(
    userId: string,
    sid?: string,
  ): { token: string; jti: string; expiresAt: Date };
  verifyRefreshToken(token: string): RefreshTokenPayload;
  parseExpiryToSeconds(expiry: string): number;
}
