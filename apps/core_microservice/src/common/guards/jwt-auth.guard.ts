import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { Request } from 'express';
import Redis from 'ioredis';
import { RedisKeys } from '@repo/shared';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Wstrzykujemy ConfigService, aby pobrać współdzielony sekret JWT
  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is missing');
    }

    let payload: string | jwt.JwtPayload;
    try {
      // Pobieramy ten sam klucz, którego używa auth_microservice
      // auth_microservice signs with JWT_SECRET; accept both names so a token
      // issued there verifies here whichever one is configured.
      const secret =
        this.configService.get<string>('JWT_ACCESS_SECRET') ||
        this.configService.get<string>('JWT_SECRET') ||
        process.env.JWT_ACCESS_SECRET ||
        process.env.JWT_SECRET;

      if (!secret) {
        throw new InternalServerErrorException(
          'JWT access secret is not configured on the server',
        );
      }

      // Weryfikacja sygnatury i dekodowanie payloadu
      payload = jwt.verify(token, secret);
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      // Jeśli token jest nieważny, wygasł (TokenExpiredError) lub zmanipulowany, odrzucamy żądanie
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
    }

    // Tokens without a jti (issued before revocation was added) can't be checked.
    const jti = typeof payload === 'string' ? undefined : payload.jti;
    if (!jti) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    // Kept apart from the verify catch above: a Redis outage is a 503, not a
    // bad token. Failing closed means a revoked token can't slip through.
    let revoked: number;
    try {
      revoked = await this.redis.exists(RedisKeys.accessBlacklist(jti));
    } catch {
      throw new ServiceUnavailableException(
        'Unable to verify token status, try again later',
      );
    }
    if (revoked === 1) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Magia: Przypinamy zweryfikowany payload do obiektu żądania (req)
    // Dzięki temu będzie on dostępny dalej w kontrolerach
    request['user'] = payload;

    return true; // Pozwalamy na przejście do kontrolera
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    // Rozdzielamy nagłówek "Authorization: Bearer <token>"
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
