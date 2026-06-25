/**
 * PostgreSQL error codes we translate into domain errors.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export enum PostgresErrorCode {
  UniqueViolation = "23505",
  ForeignKeyViolation = "23503",
  NotNullViolation = "23502",
  CheckViolation = "23514",
}
