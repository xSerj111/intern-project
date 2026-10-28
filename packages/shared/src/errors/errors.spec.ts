import { AccessDeniedError } from "./access-denied.error";
import {
  DatabaseQueryError,
  EntityByIdNotFoundError,
  EntityNotFoundError,
  UnauthorizedError,
  UniqueConstraintViolationError,
} from "./database.errors";
import { DomainError } from "./domain.error";

describe("domain errors", () => {
  it.each([
    [
      new DatabaseQueryError(),
      "DatabaseQueryError",
      "A database error occurred",
    ],
    [new DatabaseQueryError("custom"), "DatabaseQueryError", "custom"],
    [
      new UniqueConstraintViolationError("users", "dup"),
      "UniqueConstraintViolationError",
      "Unique constraint violation on users: dup",
    ],
    [
      new EntityByIdNotFoundError("users", 5),
      "EntityByIdNotFoundError",
      'users with id "5" not found',
    ],
    [
      new EntityNotFoundError("users", { a: 1 }),
      "EntityNotFoundError",
      'users not found for criteria {"a":1}',
    ],
    [new UnauthorizedError(), "UnauthorizedError", "Invalid credentials"],
    [new UnauthorizedError("nope"), "UnauthorizedError", "nope"],
    [new AccessDeniedError(), "AccessDeniedError", "Access denied"],
    [new AccessDeniedError("not yours"), "AccessDeniedError", "not yours"],
  ])(
    "%#: sets name and message and keeps the prototype chain",
    (err, name, message) => {
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe(name);
      expect(err.message).toBe(message);
    },
  );
});
