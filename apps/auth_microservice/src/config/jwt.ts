import crypto from 'crypto';

export const jwtConfig = {
  accessTokenSecret:
    process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-in-production',
  refreshTokenSecret:
    process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production',
  accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',

  /** Generate a cryptographically secure refresh token (hex string). */
  generateRefreshToken(): string {
    return crypto.randomBytes(48).toString('hex');
  },
};
