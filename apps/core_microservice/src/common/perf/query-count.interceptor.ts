import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Histogram, Registry } from 'prom-client';
import { Observable, finalize, tap } from 'rxjs';
import { AppConfigService } from '../../config/app-config.service';
import { currentQueryCount } from '../db/query-context';
import { METRICS_REGISTRY } from '../observability/metrics.tokens';

export const QUERY_COUNT_HEADER = 'X-Db-Query-Count';

const METRIC_NAME = 'db_queries_per_request';
const BUCKETS = [1, 2, 3, 5, 8, 12, 20, 30, 50];

/** `/posts/:id` from the matched route, never the raw URL (cardinality, leaked ids). */
function routeLabel(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  const path = route?.path;
  return typeof path === 'string' ? `${req.baseUrl ?? ''}${path}` : 'unmatched';
}

/**
 * Feeds `db_queries_per_request{route}` for every HTTP request and, in perf
 * runs only, exposes the same count as a response header.
 */
@Injectable()
export class QueryCountInterceptor implements NestInterceptor {
  private readonly queries: Histogram<'route'>;

  constructor(
    private readonly config: AppConfigService,
    @Inject(METRICS_REGISTRY) registry: Registry,
  ) {
    const existing = registry.getSingleMetric(METRIC_NAME);
    this.queries =
      (existing as Histogram<'route'> | undefined) ??
      new Histogram({
        name: METRIC_NAME,
        help: 'SQL statements issued while handling one HTTP request',
        labelNames: ['route'],
        buckets: BUCKETS,
        registers: [registry],
      });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const header = this.config.perfInstrumentation;

    const setHeader = () => {
      const count = currentQueryCount();
      if (header && count !== undefined && !res.headersSent) {
        res.setHeader(QUERY_COUNT_HEADER, String(count));
      }
    };
    return next.handle().pipe(
      tap({ next: setHeader, error: setHeader }),
      finalize(() => {
        const count = currentQueryCount();
        if (count !== undefined) {
          this.queries.observe({ route: routeLabel(req) }, count);
        }
      }),
    );
  }
}
