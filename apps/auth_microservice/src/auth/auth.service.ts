import { Inject, Injectable } from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';

@Injectable()
export class AuthService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
  ) {}
  // JWT verification and password comparison logic will go here
}
