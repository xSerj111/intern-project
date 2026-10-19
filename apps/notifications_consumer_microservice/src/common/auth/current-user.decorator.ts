import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Verified access-token claims set by `JwtAuthGuard`; `sub` is the user id. */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  jti: string;
  sid?: string;
  exp: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
