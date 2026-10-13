import {
  IJwtService,
  JwtPayload,
  RefreshTokenPayload,
} from '../../domain/interfaces/jwt.service.interface';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { randomUUID } from 'crypto';

export class JwtService implements IJwtService {
  signAccessToken(payload: JwtPayload): string {
    return jwt.sign(
      payload,
      env.jwt.accessTokenSecret,
      // Używamy "as any", aby uniknąć problemu z typowaniem wartości literowych (StringValue), z którym mierzyliśmy się wcześniej
      { expiresIn: env.jwt.accessTokenExpiry as any, jwtid: randomUUID() },
    );
  }

  verifyAccessToken(token: string): JwtPayload {
    // Funkcja jwt.verify rzuci błędem (np. TokenExpiredError), jeśli token jest nieważny.
    // Złapiemy ten błąd później w naszym middleware.
    const decoded = jwt.verify(token, env.jwt.accessTokenSecret) as JwtPayload;
    return decoded;
  }

  signRefreshToken(userId: string): { token: string; jti: string; expiresAt: Date } {
    const jti = randomUUID();
    const token = jwt.sign({}, env.jwt.refreshTokenSecret, {
      subject: userId,
      jwtid: jti,
      expiresIn: this.parseExpiryToSeconds(env.jwt.refreshTokenExpiry),
    });
    const { exp } = jwt.decode(token) as { exp: number };
    return { token, jti, expiresAt: new Date(exp * 1000) };
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    const decoded = jwt.verify(token, env.jwt.refreshTokenSecret) as Partial<RefreshTokenPayload>;
    if (!decoded.sub || !decoded.jti || !decoded.exp) {
      throw new Error('Malformed refresh token');
    }
    return { sub: decoded.sub, jti: decoded.jti, exp: decoded.exp };
  }

  parseExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 604800; // Domyślnie 7 dni w sekundach

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] || 1);
  }
}
