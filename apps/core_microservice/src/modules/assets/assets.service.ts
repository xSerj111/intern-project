import { Inject, Injectable } from '@nestjs/common';
import { LoggerKey, type Logger } from '@repo/shared';

@Injectable()
export class AssetsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
  ) {}
}
