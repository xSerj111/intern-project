import { QueryFailedError } from "typeorm";

interface DriverError {
  code?: string;
  detail?: string;
}

/**
 * Narrows an unknown error to a TypeORM `QueryFailedError`, exposing the
 * underlying pg `driverError` (which carries the SQLSTATE `code`).
 */
export function isTypeOrmError(
  err: unknown,
): err is QueryFailedError & { driverError: DriverError } {
  return err instanceof QueryFailedError;
}
