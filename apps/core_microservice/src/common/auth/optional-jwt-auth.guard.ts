import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenVerifier } from '@repo/shared';
import { ACCESS_TOKEN_VERIFIER } from './access-token-verifier.provider';

/**
 * For public routes that personalise the response when a user is signed in.
 * It never rejects: a missing, invalid, revoked or unverifiable token (Redis
 * down) is treated as anonymous and leaves `request.user` unset.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      return true;
    }

    const result = await this.verifier.verify(token);
    if (result.ok) {
      request['user'] = result.payload;
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
