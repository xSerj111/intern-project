import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AppConfigService } from '../../config/app-config.service';
import { currentQueryCount } from '../db/query-context';

export const QUERY_COUNT_HEADER = 'X-Db-Query-Count';

/** Exposes the per-request DB query count as a response header (perf runs only). */
@Injectable()
export class QueryCountInterceptor implements NestInterceptor {
  constructor(private readonly config: AppConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.config.perfInstrumentation) return next.handle();
    const res = context.switchToHttp().getResponse<Response>();
    const setHeader = () => {
      const count = currentQueryCount();
      if (count !== undefined && !res.headersSent) {
        res.setHeader(QUERY_COUNT_HEADER, String(count));
      }
    };
    return next.handle().pipe(tap({ next: setHeader, error: setHeader }));
  }
}
