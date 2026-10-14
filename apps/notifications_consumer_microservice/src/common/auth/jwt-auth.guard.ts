import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenVerifier } from '@repo/shared';
import { ACCESS_TOKEN_VERIFIER } from './access-token-verifier.provider';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const result = await this.verifier.verify(
      this.extractTokenFromHeader(request),
    );

    if (!result.ok) {
      switch (result.reason) {
        case 'missing':
          throw new UnauthorizedException('Authentication token is missing');
        case 'revoked':
          throw new UnauthorizedException('Token has been revoked');
        case 'unavailable':
          // Fails closed: a Redis outage is a 503, not a bad token.
          throw new ServiceUnavailableException(
            'Unable to verify token status, try again later',
          );
        default:
          throw new UnauthorizedException(
            'Invalid or expired authentication token',
          );
      }
    }

    // Verified payload is attached to the request; `user.sub` is the recipient id.
    request['user'] = result.payload;

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
