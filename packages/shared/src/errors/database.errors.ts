import { DomainError } from "./domain.error";

/** Generic failure when a database query throws unexpectedly. */
export class DatabaseQueryError extends DomainError {
  constructor(message = "A database error occurred") {
    super(message);
  }
}

/** A unique constraint was violated on insert/update. */
export class UniqueConstraintViolationError extends DomainError {
  constructor(field: string, detail: string) {
    super(`Unique constraint violation on ${field}: ${detail}`);
  }
}

/** No row matched the given id. */
export class EntityByIdNotFoundError extends DomainError {
  constructor(entity: string, id: string | number) {
    super(`${entity} with id "${id}" not found`);
  }
}

/** No row matched the given criteria. */
export class EntityNotFoundError extends DomainError {
  constructor(entity: string, criteria: unknown) {
    super(`${entity} not found for criteria ${JSON.stringify(criteria)}`);
  }
}
