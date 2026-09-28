import { Injectable, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Like `JwtAuthGuard`, but permits anonymous requests: when the
 * `Authorization` header is absent the request proceeds without a `user`.
 * When a token is present it must be valid — invalid or expired tokens still
 * yield a 401.
 *
 * Used by public read endpoints (e.g. `GET /posts/:id`) so authenticated
 * viewers get per-user fields such as `likedByMe`, while anonymous clients can
 * still read the resource.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      return true;
    }

    request['user'] = this.verifyToken(token);
    return true;
  }
}
