import { Inject, Injectable } from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
  ) {}
}
