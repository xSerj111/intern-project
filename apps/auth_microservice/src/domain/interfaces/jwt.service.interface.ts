export interface JwtPayload {
  sub: string; // Identyfikator użytkownika (User ID)
  email: string;
  jti?: string; // Unique token ID, used as the blacklist key
  iat?: number;
  exp?: number; // Unix seconds
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // refresh_token_id, keys the Redis session
  exp: number; // Unix seconds
}

export interface IJwtService {
  signAccessToken(payload: JwtPayload): string;
  verifyAccessToken(token: string): JwtPayload;
  signRefreshToken(userId: string): { token: string; jti: string; expiresAt: Date };
  verifyRefreshToken(token: string): RefreshTokenPayload;
  parseExpiryToSeconds(expiry: string): number;
}
