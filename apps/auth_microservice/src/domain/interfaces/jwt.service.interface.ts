export interface JwtPayload {
  sub: string; // Identyfikator użytkownika (User ID)
  email: string;
}

export interface IJwtService {
  signAccessToken(payload: JwtPayload): string;
  verifyAccessToken(token: string): JwtPayload;
  generateRefreshToken(): string;
  parseExpiryToSeconds(expiry: string): number;
}
