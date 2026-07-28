import { randomBytes } from 'crypto';
import { env } from './env';

export const jwtConfig = {
  accessTokenSecret: env.jwt.accessTokenSecret,
  accessTokenExpiry: env.jwt.accessTokenExpiry,
  refreshTokenExpiry: env.jwt.refreshTokenExpiry,
  generateRefreshToken: () => randomBytes(40).toString('hex'),
};
