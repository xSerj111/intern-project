import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  NotFoundException,
} from "@nestjs/common";

import { DomainError } from "../errors/domain.error";
import { ErrorsCounterLike, recordError } from "../observability/error-metrics";
import { DomainExceptionFilter } from "./domain-exception.filter";

/**
 * Catch-all global filter, so `errors_total{source="http",type=<class>}`
 * counts every error response: domain errors are mapped (and counted) by
 * {@link DomainExceptionFilter}; anything else is counted and handed to
 * `fallback`, normally Nest's `BaseExceptionFilter`, so responses stay as Nest
 * renders them (HttpException as-is, unknown errors as 500).
 * Nest's own `NotFoundException` for an unmatched route (`Cannot GET /x`, no
 * `req.route`) is delegated but not counted, so scanners and typos do not
 * inflate `errors_total`.
 * Register it as the only global filter:
 * `app.useGlobalFilters(new AllExceptionsFilter(new BaseExceptionFilter(app.getHttpAdapter()), counter))`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly domain: DomainExceptionFilter;

  constructor(
    private readonly fallback: ExceptionFilter,
    private readonly errorsCounter?: ErrorsCounterLike,
  ) {
    this.domain = new DomainExceptionFilter(errorsCounter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof DomainError) {
      this.domain.catch(exception, host);
      return;
    }
    if (this.shouldCount(exception, host)) {
      recordError(this.errorsCounter, "http", exception);
    }
    this.fallback.catch(exception, host);
  }

  private shouldCount(exception: unknown, host: ArgumentsHost): boolean {
    if (!(exception instanceof HttpException)) return true;
    if (exception.getStatus() < 400) return false;
    if (exception instanceof NotFoundException) {
      const req = host.switchToHttp().getRequest<{ route?: unknown }>();
      return req?.route != null;
    }
    return true;
  }
}
