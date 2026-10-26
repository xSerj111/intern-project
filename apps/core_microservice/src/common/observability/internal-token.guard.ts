import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { INTERNAL_TOKEN_HEADER, isValidInternalToken } from '@repo/shared';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';

/** Guards internal-only endpoints (`/health/details`, `/metrics`, `/internal/events/*`) with `X-Internal-Token`. */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = this.config.internalApiToken;
    if (
      !expected ||
      !isValidInternalToken(request.headers[INTERNAL_TOKEN_HEADER], expected)
    ) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Unauthorized',
      });
    }
    return true;
  }
}
