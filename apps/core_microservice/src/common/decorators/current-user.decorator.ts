import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Minimal shape of the request once `JwtAuthGuard` has attached the JWT payload. */
interface AuthenticatedRequest {
  user?: Record<string, unknown>;
}

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
