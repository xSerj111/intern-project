import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { INTERNAL_TOKEN_HEADER, isValidInternalToken } from '@repo/shared';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Guards `/health/details` and `/metrics`: requires `X-Internal-Token` to match
 * `INTERNAL_API_TOKEN` (constant-time). The 401 body is exactly
 * `{"statusCode":401,"message":"Unauthorized"}`.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (
      !isValidInternalToken(
        req.headers[INTERNAL_TOKEN_HEADER],
        this.config.internalApiToken,
      )
    ) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Unauthorized',
      });
    }
    return true;
  }
}
