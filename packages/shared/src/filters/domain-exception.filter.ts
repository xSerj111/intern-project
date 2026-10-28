import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";

import { AccessDeniedError } from "../errors/access-denied.error";
import {
  DatabaseQueryError,
  EntityByIdNotFoundError,
  EntityNotFoundError,
  UniqueConstraintViolationError,
} from "../errors/database.errors";
import { DomainError } from "../errors/domain.error";
import { WinstonLogger } from "../logger";
import {
  ErrorsCounterLike,
  recordError,
} from "../observability/error-metrics";

/** Minimal HTTP response shape (avoids a hard dependency on express types). */
interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}

/**
 * Translates framework-agnostic {@link DomainError}s thrown by entities and
 * repositories into HTTP responses, so the domain layer never imports HTTP.
 * Register globally in each service's `main.ts` via `app.useGlobalFilters(...)`.
 * With an `errors_total` counter (`createErrorsCounter`), every caught error
 * is counted as `{source="http", type=<error class>}`.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new WinstonLogger(DomainExceptionFilter.name);

  constructor(private readonly errorsCounter?: ErrorsCounterLike) {}

  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const status = this.statusFor(exception);
    recordError(this.errorsCounter, "http", exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception.message, { error: exception });
    } else {
      // 400-499: Domain/biznes errors -> we log as a warning for analysis
      this.logger.warn(`Domain rule violation: ${exception.name}`, {
        props: {
          message: exception.message,
          status
        }
      });
    }

    response.status(status).json({
      statusCode: status,
      error: exception.name,
      message: exception.message,
    });
  }

  private statusFor(error: DomainError): number {
    if (
      error instanceof EntityByIdNotFoundError ||
      error instanceof EntityNotFoundError
    ) {
      return HttpStatus.NOT_FOUND;
    }
    if (error instanceof AccessDeniedError) {
      return HttpStatus.FORBIDDEN;
    }
    if (error instanceof UniqueConstraintViolationError) {
      return HttpStatus.CONFLICT;
    }
    if (error instanceof DatabaseQueryError) {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }
    // Default: a business-rule violation (e.g. InvalidDisplayNameError).
    return HttpStatus.BAD_REQUEST;
  }
}
